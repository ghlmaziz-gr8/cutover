-- Business assessment of one file: a draft is made by the workspace's own model, and a platform
-- engineer approves it. Only one approved result per file in an analysis. Earlier approved results
-- are kept as superseded history. Drafts that are discarded are deleted.
create table if not exists public.file_business_assessments (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid not null references public.analyses (id) on delete cascade,
  path             text not null check (length(path) between 1 and 300),
  commit_sha       text check (commit_sha is null or length(commit_sha) <= 64),
  content          jsonb not null check (jsonb_typeof(content) = 'object' and length(content::text) <= 20000),
  review_status    text not null default 'draft' check (review_status in ('draft', 'approved', 'superseded')),
  created_by_email text,
  created_at       timestamptz not null default now(),
  reviewed_by_email text,
  reviewed_at      timestamptz
);

create index if not exists file_business_analysis_path_idx on public.file_business_assessments (analysis_id, path, review_status);

-- At most one approved result per file in an analysis.
create unique index if not exists file_business_one_approved
  on public.file_business_assessments (analysis_id, path) where review_status = 'approved';

alter table public.file_business_assessments enable row level security;
revoke all on public.file_business_assessments from anon, authenticated;
grant select, insert, update, delete on public.file_business_assessments to service_role;

-- The action log records the new business actions. The list is the one in add-retention.sql plus these.
alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop',
   'retention_delete', 'log_trim',
   'business_finish', 'business_fail', 'business_approve', 'business_supersede', 'business_discard'));
