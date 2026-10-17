-- Cutover SaaS: analysis records.
-- Run once in the Supabase SQL editor (or with supabase db push).
--
-- Source code is never stored here. Only findings and status are kept.
-- Each row is owned by one Supabase Auth user, and row-level security
-- makes sure users can read and delete only their own rows.

create table if not exists public.analyses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  repo         text not null
               check (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$'),
  ref          text check (ref is null or length(ref) <= 200),
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'complete', 'failed')),
  commit_sha   text,
  findings     jsonb,
  error        text check (error is null or length(error) <= 500),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  expires_at   timestamptz not null default (now() + interval '30 days')
);

create index if not exists analyses_owner_created_idx
  on public.analyses (owner_id, created_at desc);

create index if not exists analyses_expires_idx
  on public.analyses (expires_at);

alter table public.analyses enable row level security;

-- Table privileges. The Data API does not expose new tables automatically
-- (we turn that off in the project), so access is granted here explicitly.
-- Anonymous visitors get nothing. Signed-in users get only what the policies
-- below allow. Users cannot update rows. The service role handles status changes.
revoke all on public.analyses from anon;
grant select, insert, delete on public.analyses to authenticated;
grant select, insert, update, delete on public.analyses to service_role;

-- Users can create rows only for themselves.
create policy "analyses: owners insert"
  on public.analyses for insert
  with check (auth.uid() = owner_id);

-- Users can read their own rows.
create policy "analyses: owners read"
  on public.analyses for select
  using (auth.uid() = owner_id);

-- Users can delete their own rows (deletion on request).
create policy "analyses: owners delete"
  on public.analyses for delete
  using (auth.uid() = owner_id);

-- No update policy for users. Status changes come from the runner callback,
-- which uses the service role key on the server side only.
