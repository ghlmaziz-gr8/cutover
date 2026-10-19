-- Run once in the Supabase SQL editor, after add-model-keys.sql and add-google-provider.sql.
-- Lets an analysis record which model and key it used, and adds one-time tokens for the runner.
-- Safe to run again.

alter table public.analyses add column if not exists model_provider text
  check (model_provider in ('anthropic', 'google'));
alter table public.analyses add column if not exists model_key_id uuid references public.model_keys (id) on delete set null;
alter table public.analyses add column if not exists model_notice_version text check (length(model_notice_version) <= 40);
alter table public.analyses add column if not exists model_chosen_by_email text check (length(model_chosen_by_email) <= 320);

create table if not exists public.analysis_model_tokens (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.analyses (id) on delete cascade,
  model_key_id uuid not null references public.model_keys (id) on delete cascade,
  token_hash   text not null unique check (length(token_hash) = 64),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);

alter table public.analysis_model_tokens enable row level security;
revoke all on public.analysis_model_tokens from anon, authenticated, service_role;
grant select, insert, update on public.analysis_model_tokens to service_role;
