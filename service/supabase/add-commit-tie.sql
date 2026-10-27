-- Ties each assessment to the commit it read, and records the branch's latest commit when it was last checked.
-- Run once in the Supabase SQL Editor. Safe to run again.
alter table public.analyses add column if not exists head_sha text check (head_sha is null or length(head_sha) <= 64);
alter table public.analyses add column if not exists head_checked_at timestamptz;
