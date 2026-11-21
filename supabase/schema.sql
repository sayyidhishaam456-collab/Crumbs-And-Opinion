-- Crumbs & Opinions database setup
create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default 'Anonymous Foodie',
  restaurant text not null,
  location text not null,
  category text not null,
  dishes text not null,
  rating numeric(3,1) not null check (rating >= 0 and rating <= 10),
  original_review text not null,
  polished_review text not null,
  title text not null,
  photo_paths text[] not null default '{}',
  drive_file_ids text[] not null default '{}',
  drive_backup_status text not null default 'not_configured' check (drive_backup_status in ('not_configured','complete','incomplete','partial_or_failed')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

-- The public site reads approved reviews through the Edge Function only.
-- Do not add public INSERT or UPDATE policies.
drop policy if exists "Public can read approved reviews" on public.reviews;
create policy "Public can read approved reviews"
on public.reviews for select
to anon, authenticated
using (status = 'approved');

-- Private bucket: images are returned to the public only as short-lived signed URLs
-- after their associated review has been approved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
allowed_mime_types = array['image/jpeg','image/png','image/webp'];
