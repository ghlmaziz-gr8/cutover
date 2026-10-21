-- Terraform drafts for Migrate: numbered versions, never overwritten. Run once in the Supabase SQL editor.
-- Safe to run again. Run it before the Worker that includes these changes is deployed.

create table if not exists public.terraform_versions (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid not null references public.analyses (id) on delete cascade,
  version          integer not null check (version >= 1),
  cloud            text not null check (cloud in ('google', 'aws', 'azure')),
  content          text not null check (length(content) <= 60000),
  inputs           jsonb not null,
  created_by_email text not null,
  created_at       timestamptz not null default now(),
  unique (analysis_id, version)
);

alter table public.terraform_versions enable row level security;
revoke all on public.terraform_versions from anon, authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'analysis_started', 'analysis_complete', 'analysis_failed',
  'privacy_signed_off', 'privacy_withdrawn',
  'model_key_added', 'model_key_removed',
  'comment_added', 'action_added', 'action_done',
  'scope_chosen', 'deeper_ready', 'plan_accepted', 'plan_rejected', 'purposes_approved',
  'cloud_chosen', 'intake_confirmed', 'terraform_drafted'));
