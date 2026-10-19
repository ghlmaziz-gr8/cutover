-- Run once in the Supabase SQL editor. Records whether each file's purpose was written by the
-- rules engine or by the workspace's own model. Existing rows are set to 'rules'. Safe to run again.

alter table public.file_findings add column if not exists purpose_source text not null default 'rules'
  check (purpose_source in ('rules', 'model'));
