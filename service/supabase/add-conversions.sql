-- One converted file per analysis and file path: the proposal, its outcome and the reviewer's decision.
-- Only the service role reads and writes it. Run once in the Supabase SQL Editor. Safe to run again.
create table if not exists public.analysis_conversions (
  id                 uuid primary key default gen_random_uuid(),
  analysis_id        uuid not null references public.analyses (id) on delete cascade,
  path               text not null check (length(path) between 1 and 300),
  template           text not null check (template in ('web-modern', 'services-data', 'lift-contain')),
  status             text not null check (status in ('queued', 'ok', 'blocked', 'unusable', 'failed', 'refused')),
  proposed           text check (proposed is null or length(proposed) <= 60000),
  reason             text check (reason is null or length(reason) <= 300),
  kinds              text[] not null default '{}',
  stage              text,
  requested_by_email text,
  decision           text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  decided_by_email   text,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (analysis_id, path)
);

alter table public.analysis_conversions enable row level security;
revoke all on public.analysis_conversions from anon, authenticated;
grant select, insert, update, delete on public.analysis_conversions to service_role;
