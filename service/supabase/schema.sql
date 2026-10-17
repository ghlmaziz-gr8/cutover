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

-- Access list. Only people listed here can use the portal.
-- An invitation is created by a workspace admin. The first time the invited person signs in,
-- the Worker turns the invitation into a row in members and deletes the invitation.
-- Nobody reaches these tables directly. Only the Worker, using the service role, reads and writes them.

create table if not exists public.members (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null
              check (role in ('platform_engineer', 'application_owner', 'developer', 'compliance_reviewer', 'workspace_admin')),
  created_at  timestamptz not null default now()
);

create table if not exists public.invitations (
  email       text primary key
              check (email = lower(email) and length(email) <= 320),
  role        text not null
              check (role in ('platform_engineer', 'application_owner', 'developer', 'compliance_reviewer', 'workspace_admin')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.members enable row level security;
alter table public.invitations enable row level security;

revoke all on public.members from anon, authenticated;
revoke all on public.invitations from anon, authenticated;
grant select, insert, update, delete on public.members to service_role;
grant select, insert, update, delete on public.invitations to service_role;

-- First admin (run once in the SQL editor, after schema.sql):
--   insert into public.invitations (email, role)
--   values ('ghlmaziz@gmail.com', 'workspace_admin')
--   on conflict (email) do update set role = excluded.role;

-- Discussion on an analysis. Every member can read these, through the Worker.
create table if not exists public.analysis_comments (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.analyses (id) on delete cascade,
  author_id    uuid references auth.users (id) on delete set null,
  author_email text not null,
  body         text not null check (length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create index if not exists analysis_comments_analysis_idx
  on public.analysis_comments (analysis_id, created_at);

-- Action items on an analysis. Any member except a compliance reviewer can add and close them.
create table if not exists public.action_items (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid not null references public.analyses (id) on delete cascade,
  title            text not null check (length(title) between 1 and 200),
  status           text not null default 'open' check (status in ('open', 'done')),
  created_by       uuid references auth.users (id) on delete set null,
  created_by_email text not null,
  done_by_email    text,
  created_at       timestamptz not null default now(),
  done_at          timestamptz
);

create index if not exists action_items_analysis_idx
  on public.action_items (analysis_id, created_at);

alter table public.analysis_comments enable row level security;
alter table public.action_items enable row level security;

revoke all on public.analysis_comments from anon, authenticated;
revoke all on public.action_items from anon, authenticated;
grant select, insert, update, delete on public.analysis_comments to service_role;
grant select, insert, update, delete on public.action_items to service_role;

-- Assessment wizard: application name and the data-rules confirmation.
-- Safe to run once. Existing rows keep these values empty.
alter table public.analyses add column if not exists app_name text;
alter table public.analyses add column if not exists data_rules_confirmed_at timestamptz;
