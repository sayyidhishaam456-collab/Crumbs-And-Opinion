// Supabase Edge Function: reviews
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
// Optional: OPENAI_MODEL (defaults to gpt-4.1-mini)
// Optional Drive backup: GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_FOLDER_ID
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const env = (name: string) => Deno.env.get(name) ?? "";

function clean(value: FormDataEntryValue | null, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Backend secrets are not configured.");
  const headers = new Headers(init.headers ?? {});
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  return await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
}

async function polishReview(data: Record<string, string>): Promise<{title:string; review:string}> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("The AI editor is not configured yet.");
  const model = env("OPENAI_MODEL") || "gpt-4.1-mini";
  const prompt = `You are the playful but honest editor for Crumbs & Opinions, a food review blog.
Rewrite the submitted notes into lively, colourful, clear review prose with a short catchy title.
NON-NEGOTIABLE RULES:
- Preserve the reviewer's actual meaning, opinions, and rating.
- Do not invent flavours, ingredients, textures, prices, service, atmosphere, events, or facts.
- Do not turn uncertain statements into facts.
- If the notes are brief, keep the rewrite brief rather than adding unsupported details.
- Do not change the rating.
- Keep it respectful and avoid insults toward staff or other people.
Return only JSON with keys "title" and "review".
Restaurant: ${data.restaurant}
Location: ${data.location}
Dishes: ${data.dishes}
Rating: ${data.rating}/10
Reviewer's notes: ${data.reviewText}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 500,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "AI editing failed.");
  const outputText = (body.output ?? [])
    .filter((item: any) => item.type === "message")
    .flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text")
    .map((part: any) => part.text)
    .join("");
  const parsed = JSON.parse(outputText || "{}");
  const title = String(parsed.title || `${data.restaurant} review`).slice(0, 90);
  const review = String(parsed.review || data.reviewText).slice(0, 3500);
  return { title, review };
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleDriveToken(): Promise<string> {
  const raw = env("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("Google Drive backup is not configured.");
  const account = JSON.parse(raw);
  if (!account.client_email || !account.private_key) throw new Error("Google service account JSON is incomplete.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64url(signature)}`;
  const tokenResponse = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) throw new Error("Google Drive authorisation failed.");
  return tokenBody.access_token;
}

async function backupPhotoToDrive(photo: File, objectPath: string): Promise<string> {
  const folderId = env("GOOGLE_DRIVE_FOLDER_ID");
  if (!folderId) throw new Error("Google Drive folder ID is missing.");
  const token = await googleDriveToken();
  const metadata = { name: `crumbs-${objectPath}`, parents: [folderId], mimeType: photo.type };
  const boundary = `crumbs_${crypto.randomUUID().replaceAll("-", "")}`;
  const fileBytes = new Uint8Array(await photo.arrayBuffer());
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${photo.type}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--`);
  const multipartBody = new Uint8Array(prefix.length + fileBytes.length + suffix.length);
  multipartBody.set(prefix, 0);
  multipartBody.set(fileBytes, prefix.length);
  multipartBody.set(suffix, prefix.length + fileBytes.length);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  const result = await response.json();
  if (!response.ok || !result.id) throw new Error("Google Drive photo backup failed.");
  return String(result.id);
}

async function submitReview(form: FormData) {
  // Honeypot: hidden field should remain empty.
  if (clean(form.get("website"), 200)) return json({ message: "Thanks for your submission." }, 200);
  if (clean(form.get("consentToEditAndPublish"), 10) !== "true") {
    return json({ error: "Please confirm the review permission checkbox." }, 400);
  }

  const data = {
    displayName: clean(form.get("displayName"), 40) || "Anonymous Foodie",
    restaurant: clean(form.get("restaurant"), 100),
    location: clean(form.get("location"), 120),
    category: clean(form.get("category"), 20),
    dishes: clean(form.get("dishes"), 250),
    rating: clean(form.get("rating"), 5),
    reviewText: clean(form.get("reviewText"), 2500),
  };
  if (!data.restaurant || !data.location || !data.dishes || data.reviewText.length < 15) {
    return json({ error: "Please complete all required fields and write at least 15 characters." }, 400);
  }
  const rating = Number(data.rating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) return json({ error: "Rating must be between 0 and 10." }, 400);
  if (!["mains","dessert","drinks","cafe","other"].includes(data.category)) return json({ error: "Choose a valid category." }, 400);

  const photos = form.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
  if (photos.length > 3) return json({ error: "Please upload no more than 3 photos." }, 400);
  for (const photo of photos) {
    if (photo.size > 5 * 1024 * 1024 || !["image/jpeg","image/png","image/webp"].includes(photo.type)) {
      return json({ error: "Each photo must be JPG, PNG or WebP and 5 MB or smaller." }, 400);
    }
  }

  const polished = await polishReview(data);
  const photoPaths: string[] = [];
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  for (const photo of photos) {
    const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    const objectPath = `${crypto.randomUUID()}.${ext}`;
    const upload = await fetch(`${supabaseUrl}/storage/v1/object/review-photos/${objectPath}`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": photo.type,
        "x-upsert": "false",
      },
      body: await photo.arrayBuffer(),
    });
    if (!upload.ok) throw new Error("A photo could not be saved. Please try again.");
    photoPaths.push(objectPath);
  }

  // Drive is a secondary archive. If it is not configured or is temporarily
  // unavailable, the primary Supabase submission still succeeds.
  const driveFileIds: string[] = [];
  let driveBackupStatus = "not_configured";
  if (env("GOOGLE_SERVICE_ACCOUNT_JSON") && env("GOOGLE_DRIVE_FOLDER_ID")) {
    driveBackupStatus = "partial_or_failed";
    for (let i = 0; i < photos.length; i++) {
      try { driveFileIds.push(await backupPhotoToDrive(photos[i], photoPaths[i])); }
      catch (_error) { /* Do not expose credentials or fail the main submission. */ }
    }
    driveBackupStatus = driveFileIds.length === photos.length ? "complete" : "incomplete";
  }

  const insert = await supabaseRequest("reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify({
      display_name: data.displayName,
      restaurant: data.restaurant,
      location: data.location,
      category: data.category,
      dishes: data.dishes,
      rating,
      original_review: data.reviewText,
      polished_review: polished.review,
      title: polished.title,
      photo_paths: photoPaths,
      drive_file_ids: driveFileIds,
      drive_backup_status: driveBackupStatus,
      status: "pending",
    }),
  });
  if (!insert.ok) throw new Error("Your review could not be saved. Please try again.");
  return json({ message: "Thank you! Your review is submitted and waiting for approval.", driveBackupStatus }, 200);
}

async function listApproved() {
  const result = await supabaseRequest("reviews?select=id,display_name,restaurant,location,category,dishes,rating,polished_review,title,photo_paths,created_at&status=eq.approved&order=created_at.desc&limit=60");
  if (!result.ok) throw new Error("Approved reviews could not be loaded.");
  const reviews = await result.json();
  const withPhotos = await Promise.all(reviews.map(async (review: any) => {
    const photo_urls: string[] = [];
    for (const path of (review.photo_paths ?? []).slice(0,3)) {
      const signed = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/sign/review-photos/${path}`, {
        method: "POST",
        headers: {
          "apikey": env("SUPABASE_SERVICE_ROLE_KEY"),
          "Authorization": `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (signed.ok) {
        const data = await signed.json();
        photo_urls.push(`${env("SUPABASE_URL")}/storage/v1${data.signedURL}`);
      }
    }
    return { ...review, photo_urls };
  }));
  return json({ reviews: withPhotos });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "approved") {
      return await listApproved();
    }
    if (req.method === "POST") {
      return await submitReview(await req.formData());
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
