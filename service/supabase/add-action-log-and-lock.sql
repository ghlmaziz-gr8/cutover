-- Action log and one running assessment per workspace. Run once in the Supabase SQL Editor. Safe to run again.
-- The log is append-only: the service role may read and insert, never change or delete. It holds
-- identifiers and actions only: no code, file contents, configuration values, secrets or model replies.
create table if not exists public.assessment_log (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  actor_user_id   uuid,
  actor_email     text check (actor_email is null or length(actor_email) <= 320),
  action          text not null check (action in ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop')),
  analysis_id     uuid,
  repo            text check (repo is null or length(repo) <= 140),
  commit_sha      text check (commit_sha is null or length(commit_sha) <= 64),
  detail          text check (detail is null or length(detail) <= 300),
  created_at      timestamptz not null default now()
);

-- No foreign key to workspaces on purpose: the log of a deleted workspace is kept until its owner removes it.
create index if not exists assessment_log_workspace_idx on public.assessment_log (workspace_id, created_at desc);

alter table public.assessment_log enable row level security;
revoke all on public.assessment_log from anon, authenticated;
grant select, insert on public.assessment_log to service_role;
revoke update, delete, truncate, references, trigger on public.assessment_log from service_role;

-- One running assessment per workspace, enforced by the database, so two starts at the same moment cannot both win.
-- If this fails with "could not create unique index", two runs are already queued or running in one workspace.
-- Find them with: select workspace_id, count(*) from analyses where status in ('queued','running') group by 1 having count(*) > 1;
create unique index if not exists analyses_one_running_per_workspace
  on public.analyses (workspace_id) where status in ('queued', 'running');
