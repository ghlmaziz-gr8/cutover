-- Target language for the modernized application: the chosen language, the named application owner, and a
-- record of every approval (kept, so an earlier approval stays on record after the language changes).
-- Only the service role reads and writes the approvals. Run once in the Supabase SQL Editor. Safe to run again.
alter table public.analyses add column if not exists target_language text;
alter table public.analyses add column if not exists target_language_set_by_email text;
alter table public.analyses add column if not exists target_language_set_at timestamptz;
alter table public.analyses add column if not exists target_owner_email text;

create table if not exists public.analysis_target_approvals (
  id                uuid primary key default gen_random_uuid(),
  analysis_id       uuid not null references public.analyses (id) on delete cascade,
  language          text not null check (length(language) between 1 and 60),
  approved_by_email text not null,
  approved_at       timestamptz not null default now()
);

alter table public.analysis_target_approvals enable row level security;
revoke all on public.analysis_target_approvals from anon, authenticated;
grant select, insert, update, delete on public.analysis_target_approvals to service_role;
