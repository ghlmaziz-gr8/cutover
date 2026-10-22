-- Run once in the Supabase SQL editor, after add-scope.sql.
-- Lets a platform engineer choose the modernized template for an analysis, and records who chose it and when.
-- Safe to run again.

alter table public.analyses add column if not exists modern_template text
  check (modern_template in ('web-modern', 'services-data', 'lift-contain'));
alter table public.analyses add column if not exists modern_template_set_by_email text
  check (length(modern_template_set_by_email) <= 320);
alter table public.analyses add column if not exists modern_template_set_at timestamptz;
