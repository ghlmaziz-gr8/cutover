-- Feature grouping: the model proposes feature groups from the approved business results of one analysis.
-- A platform engineer approves a grouping. One approved grouping per analysis; earlier ones are kept as superseded.
create table if not exists public.feature_groupings (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid not null references public.analyses (id) on delete cascade,
  status           text not null default 'running' check (status in ('running', 'draft', 'approved', 'superseded')),
  groups           jsonb not null default '[]'::jsonb check (jsonb_typeof(groups) = 'array' and length(groups::text) <= 40000),
  source_count     integer not null default 0 check (source_count >= 0),
  created_by_email text,
  created_at       timestamptz not null default now(),
  reviewed_by_email text,
  reviewed_at      timestamptz
);

create index if not exists feature_groupings_analysis_idx on public.feature_groupings (analysis_id, status);

-- At most one approved grouping per analysis.
create unique index if not exists feature_groupings_one_approved
  on public.feature_groupings (analysis_id) where status = 'approved';

alter table public.feature_groupings enable row level security;
revoke all on public.feature_groupings from anon, authenticated;
grant select, insert, update, delete on public.feature_groupings to service_role;

-- The action log records the grouping actions too. The list keeps every action added so far.
alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop',
   'retention_delete', 'log_trim',
   'business_start', 'business_finish', 'business_fail', 'business_approve', 'business_supersede', 'business_discard',
   'business_cleanup',
   'grouping_start', 'grouping_finish', 'grouping_fail', 'grouping_approve', 'grouping_supersede', 'grouping_discard'));
