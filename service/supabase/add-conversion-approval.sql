-- Written approval, given by a workspace admin, before any file is converted with the language model.
-- Run once in the Supabase SQL Editor. Safe to run again.
alter table public.workspaces add column if not exists conversion_approved_by_email text
  check (conversion_approved_by_email is null or length(conversion_approved_by_email) <= 320);
alter table public.workspaces add column if not exists conversion_approved_at timestamptz;
alter table public.workspaces add column if not exists conversion_approval_version int;
