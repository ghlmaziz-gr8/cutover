-- Run once in the Supabase SQL editor. Time on the system per workspace, per person and day (UTC).
-- Only the Worker writes and reads this table. Safe to run again.

create table if not exists public.workspace_time (
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  day           date not null,
  seconds       integer not null default 0 check (seconds >= 0),
  primary key (user_id, workspace_id, day)
);

alter table public.workspace_time enable row level security;
revoke all on public.workspace_time from anon, authenticated;
