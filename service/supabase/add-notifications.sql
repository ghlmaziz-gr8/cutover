-- Run once in the Supabase SQL editor. Saved notifications for the portal's bell.
-- One row per person per event. Only the Worker writes and reads this table. Safe to run again.

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  analysis_id   uuid references public.analyses (id) on delete cascade,
  kind          text not null check (kind in (
                  'analysis_started', 'analysis_complete', 'analysis_failed',
                  'privacy_signed_off', 'privacy_withdrawn',
                  'model_key_added', 'model_key_removed',
                  'comment_added', 'action_added', 'action_done')),
  tone          text not null check (tone in ('info', 'success', 'warning', 'danger', 'ai')),
  title         text not null check (length(title) between 1 and 160),
  body          text not null default '' check (length(body) <= 400),
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
