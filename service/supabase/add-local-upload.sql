-- Run once in the Supabase SQL editor, after schema.sql and add-analysis-model.sql.
-- Lets a platform engineer analyse a zip of the code from their computer, without GitHub.
-- The zip is stored privately for the run only: the runner reads it once, then the Worker deletes it.
-- Safe to run again.

alter table public.analyses add column if not exists source_kind text not null default 'github'
  check (source_kind in ('github', 'upload'));
alter table public.analyses add column if not exists source_path text
  check (length(source_path) <= 80);

-- A private bucket, 50 MB per file, zip files only. Nothing in it is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('analysis-sources', 'analysis-sources', false, 52428800, array['application/zip'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/zip'];
