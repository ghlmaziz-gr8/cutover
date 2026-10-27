-- Run once in the Supabase SQL editor. Time on the system, for the points and the login card.
-- screen_time: seconds per person, per day (UTC), per screen. engagement: running totals and the previous visit.
-- Only the Worker writes and reads these tables. Safe to run again.

create table if not exists public.screen_time (
  user_id   uuid not null references auth.users (id) on delete cascade,
  day       date not null,
  screen    text not null check (screen ~ '^s-[a-z-]{1,38}$'),
  seconds   integer not null default 0 check (seconds >= 0),
  primary key (user_id, day, screen)
);

create table if not exists public.engagement (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  total_seconds       bigint not null default 0 check (total_seconds >= 0),
  last_seen           timestamptz,
  visit_start_total   bigint not null default 0 check (visit_start_total >= 0),
  previous_seen       timestamptz,
  previous_visit_seconds bigint not null default 0 check (previous_visit_seconds >= 0)
);

alter table public.screen_time enable row level security;
alter table public.engagement enable row level security;
revoke all on public.screen_time from anon, authenticated;
revoke all on public.engagement from anon, authenticated;
