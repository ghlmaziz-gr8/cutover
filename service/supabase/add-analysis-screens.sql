-- Run once in the Supabase SQL editor. Screens drawn by the workspace's own model from the code.
-- Holds the drawn HTML only: no code, and sample data only. Safe to run again.

create table if not exists public.analysis_screens (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.analyses (id) on delete cascade,
  path         text not null check (length(path) between 1 and 512),
  name         text not null check (length(name) between 1 and 120),
  html         text not null check (length(html) between 50 and 40000),
  created_at   timestamptz not null default now(),
  unique (analysis_id, path)
);

alter table public.analysis_screens enable row level security;
revoke all on public.analysis_screens from anon, authenticated;
grant select, insert, delete on public.analysis_screens to service_role;
