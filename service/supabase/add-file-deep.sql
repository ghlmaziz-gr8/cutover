-- Deep file assessment: for one file, what it does, its functions, what they call, and user stories.
-- A draft becomes the approved account of that file when an engineer approves it. One approved account per file;
-- earlier approved accounts are kept as superseded. Each account is tied to the commit it was made from.
create table if not exists public.file_deep_assessments (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid not null references public.analyses (id) on delete cascade,
  file_path        text not null check (char_length(file_path) <= 1000),
  status           text not null default 'running' check (status in ('running', 'draft', 'approved', 'superseded')),
  content          jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and length(content::text) <= 200000),
  confidence       text not null default 'model_read' check (confidence in ('rule_pack', 'model_read')),
  dropped          integer not null default 0 check (dropped >= 0),
  commit_sha       text,
  created_by_email text,
  created_at       timestamptz not null default now(),
  reviewed_by_email text,
  reviewed_at      timestamptz
);

create index if not exists file_deep_assessments_file_idx on public.file_deep_assessments (analysis_id, file_path, status);

-- At most one approved account per file of an analysis.
create unique index if not exists file_deep_assessments_one_approved
  on public.file_deep_assessments (analysis_id, file_path) where status = 'approved';

alter table public.file_deep_assessments enable row level security;
revoke all on public.file_deep_assessments from anon, authenticated;
grant select, insert, update, delete on public.file_deep_assessments to service_role;

-- The action log records the deep assessment actions too. The list keeps every action added so far.
alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop',
   'retention_delete', 'log_trim',
   'business_start', 'business_finish', 'business_fail', 'business_approve', 'business_supersede', 'business_discard',
   'business_cleanup',
   'grouping_start', 'grouping_finish', 'grouping_fail', 'grouping_approve', 'grouping_supersede', 'grouping_discard',
   'deep_file_start', 'deep_file_finish', 'deep_file_fail', 'deep_file_approve', 'deep_file_supersede', 'deep_file_discard'));
