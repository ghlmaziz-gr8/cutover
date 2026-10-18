-- Adds the privacy sign-off table to an existing Cutover database. Run once in the Supabase SQL editor.
-- Safe to run again: every statement checks whether it is already in place.
-- Same table and rules as in schema.sql.

create table if not exists public.privacy_signoffs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  email           text not null check (length(email) <= 320),
  full_name       text not null check (length(full_name) between 2 and 200),
  action          text not null check (action in ('signed_off', 'withdrawn')),
  notice_version  text not null check (length(notice_version) between 1 and 40),
  notice_text     text not null check (length(notice_text) <= 8000),
  statements      jsonb not null default '[]'::jsonb check (jsonb_typeof(statements) = 'array'),
  created_at      timestamptz not null default now()
);

create index if not exists privacy_signoffs_workspace_idx on public.privacy_signoffs (workspace_id, created_at desc);

alter table public.privacy_signoffs enable row level security;
revoke all on public.privacy_signoffs from anon, authenticated;
grant select, insert on public.privacy_signoffs to service_role;
