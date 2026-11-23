# Crumbs & Opinions — website + review backend

A complete **source package** for the Crumbs & Opinions GitHub Pages site, review submission backend, AI-assisted editing, moderation, private photo storage, and optional Google Drive photo backup.

## Included
- Original cherry-red / butter-yellow blog design and the Pestle & Mortar, Setia Alam review (Big Breakfast A, banana split, hotcakes; 10/10) with the supplied photos.
- Visitor review form with anonymous default display name.
- Up to 3 JPG/PNG/WebP photos per submission (5 MB each).
- Server-side AI editing that must preserve the reviewer's opinion and rating and may not invent food details. Default model: `gpt-4.1-mini` (change to a model enabled for the API account if needed).
- Reviews enter `pending`; only an adult moderator should approve them for publication.
- Supabase private storage is the primary photo store.
- Optional Google Drive backup uploads each photo to the private folder you supplied. Drive failures do not discard the main Supabase submission; status is stored with each review.

## Important: not live yet
This ZIP contains source code. I cannot sign in to your GitHub, Supabase, OpenAI, or Google accounts, deploy it, or verify a live end-to-end submission from this chat. The site/backend/Drive backup become active only after the setup below is completed and tested. Because account setup and API billing are involved, ask a parent/guardian to manage the accounts, permissions, and billing. **Never paste API keys, service-account JSON, or passwords into chat or commit them to GitHub.**

## 1. Supabase setup
1. An adult creates a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor. This creates the reviews table and a private `review-photos` bucket.
3. Deploy the Edge Function in `supabase/functions/reviews/` as `reviews`. Keep the service-role key only in server-side secrets.
4. Set these Edge Function secrets:
   - `SUPABASE_URL` — project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — service-role key (secret)
   - `OPENAI_API_KEY` — API key (secret)
   - `OPENAI_MODEL` — optional; defaults to `gpt-4.1-mini`

## 2. Google Drive backup setup (optional)
The target folder ID is already placed in `supabase/drive-setup.txt`: `1vcjn7RlX3I36YQ0hFa1-u6ew52LWJuFB`. The folder must remain private.

1. An adult creates/chooses a Google Cloud project and enables the Google Drive API.
2. Create a service account and a JSON key. Treat the JSON key as a password.
3. Share **only the target backup folder** with the service account's `client_email`, granting Editor access. Do not make the folder public.
4. Add these Edge Function secrets in Supabase (never in the website):
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the complete service-account JSON contents
   - `GOOGLE_DRIVE_FOLDER_ID` — `1vcjn7RlX3I36YQ0hFa1-u6ew52LWJuFB`
5. Redeploy the `reviews` Edge Function. Submit a test review with one small photo and verify the file appears in the private Drive folder. The API response includes `driveBackupStatus`; the database row records `drive_backup_status`.

If Drive secrets are absent, submissions still save to Supabase and the status is `not_configured`. If Drive is unavailable, the main submission still succeeds but the backup status is `incomplete`. Check the Drive folder and status before relying on backups.

## 3. Connect the website to Supabase
1. In `index.html`, find `PASTE_YOUR_SUPABASE_FUNCTION_URL_HERE`.
2. Replace it with `https://YOUR_PROJECT_REF.supabase.co/functions/v1/reviews`. This is a public function URL, not a secret.
3. Commit the updated `index.html` to the GitHub Pages repository. Do not commit any secrets or service-account files.

## 4. Moderation
Open Supabase Table Editor → `public.reviews`. Check the original notes, AI-polished version, rating, and photos. Set `status` to `approved` only after review; set it to `rejected` otherwise. The public endpoint returns approved reviews only. Do not publish personal information or photos without permission.

## 5. Test checklist
- [ ] Website loads on GitHub Pages.
- [ ] A review without photos submits and appears as `pending`.
- [ ] A review with a photo saves to the private Supabase bucket.
- [ ] If Drive is configured, the photo also appears in the private Drive folder and status is `complete`.
- [ ] A pending review is not shown publicly.
- [ ] An approved review appears on the site with its photo.
- [ ] Invalid file types, files over 5 MB, and more than 3 photos are rejected.

## Safety / operations
This is a starter public form, not a hardened high-traffic service. Before broad public launch, add rate limiting or bot protection, a report/deletion process, and an adult moderation workflow. AI editing is not fact-checking; always review the original and edited text. API usage may cost money. Keep Supabase storage private and keep all service keys server-side.


## Owner dashboard setup
The package includes `admin.html` for Google sign-in, homepage text editing, and review moderation.

1. Run the updated `supabase/schema.sql` in Supabase SQL Editor.
2. Set Edge Function secrets `SUPABASE_ANON_KEY` (public anon/publishable key) and `ADMIN_EMAILS` (`crumbsopinion@gmail.com`). Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
3. Deploy the updated `supabase/functions/reviews/index.ts`.
4. Enable Google under Supabase Authentication → Providers. Configure a Google OAuth client and add your website URL and `admin.html` URL to authorised redirect URLs.
5. Replace `PASTE_YOUR_SUPABASE_FUNCTION_URL_HERE` in `index.html` with `https://YOUR_PROJECT_REF.supabase.co/functions/v1/reviews`.
6. Open `admin.html`, enter your Supabase project URL and public anon key, save, and sign in with `crumbsopinion@gmail.com`.

The Edge Function checks the verified Supabase user email against the server-side `ADMIN_EMAILS` secret for every owner-only operation. The browser-side email check is not the security boundary. Never put service-role keys, API keys, or passwords in website files or chat.

This is a completed source package, not a live deployment. Supabase, Google OAuth, hosting, and API credentials still need to be configured by the account owner/trusted adult and tested before the site is live.


## Owner login link
The public homepage includes an **OWNER LOGIN** link that opens `admin.html`. The dashboard remains protected by Google sign-in and the server-side `ADMIN_EMAILS` allowlist. Configure and deploy the site as described above before using it.
