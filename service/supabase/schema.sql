-- Cutover SaaS: final schema for a NEW Supabase project.
-- Existing database: run migrate-to-workspaces.sql once instead of this file.
--
-- Every customer is a workspace. Each row belongs to one workspace, and only people invited to
-- that workspace can see it. Nobody reaches these tables from the browser: the Worker (service role)
-- is the only way in, and it checks workspace membership on every request. Browsers get no table access.
-- Source code is never stored here. Only findings and status are kept.

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 200),
  created_at  timestamptz not null default now()
);

create table if not exists public.analyses (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  repo          text not null
                check (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$'),
  ref           text check (ref is null or length(ref) <= 200),
  app_name      text,
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'complete', 'failed')),
  commit_sha    text,
  findings      jsonb,
  error         text check (error is null or length(error) <= 500),
  data_rules_confirmed_at timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '30 days')
);

create index if not exists analyses_workspace_created_idx
  on public.analyses (workspace_id, created_at desc);

create index if not exists analyses_expires_idx
  on public.analyses (expires_at);

-- A person's place in one workspace. A person can be in several workspaces, with a role in each.
-- Roles: platform_engineer, security_officer, informatics_lead, cio_cto, auditor.
-- is_admin lets someone invite and remove people in that workspace.
create table if not exists public.members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  email         text not null,
  role          text not null
                check (role in ('platform_engineer', 'security_officer', 'informatics_lead', 'cio_cto', 'auditor')),
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists members_user_idx on public.members (user_id);

-- Invitations for a workspace. The first time the invited person signs in, the Worker turns each
-- invitation into a members row and deletes the invitation.
create table if not exists public.invitations (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null
                check (email = lower(email) and length(email) <= 320),
  role          text not null
                check (role in ('platform_engineer', 'security_officer', 'informatics_lead', 'cio_cto', 'auditor')),
  is_admin      boolean not null default false,
  invited_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, email)
);

-- Discussion on an analysis. Every member of its workspace can read and add these.
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

-- Action items on an analysis. Any member except an auditor can add and close them.
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

-- Deletion records: one row each time an analysis is deleted, by the retention job or on request.
-- Holds no findings and no patient data: only the analysis id, the repository name, the reason and the time.
create table if not exists public.deletion_log (
  id           bigint generated always as identity primary key,
  analysis_id  uuid not null,
  repo         text not null,
  reason       text not null check (reason in ('expired', 'requested')),
  deleted_at   timestamptz not null default now()
);

-- Locks. Turn on row-level security for every table, and give no access to browsers.
-- The service role (used only by the Worker) bypasses row-level security and gets what it needs.
alter table public.workspaces enable row level security;
alter table public.analyses enable row level security;
alter table public.members enable row level security;
alter table public.invitations enable row level security;
alter table public.analysis_comments enable row level security;
alter table public.action_items enable row level security;
alter table public.deletion_log enable row level security;

revoke all on public.workspaces, public.analyses, public.members, public.invitations,
  public.analysis_comments, public.action_items, public.deletion_log
  from anon, authenticated;

grant select, insert, update, delete on public.workspaces, public.analyses, public.members,
  public.invitations, public.analysis_comments, public.action_items to service_role;
grant select, insert on public.deletion_log to service_role;

-- First workspace admin, after the Worker is deployed. Replace the workspace name and email:
--   insert into public.workspaces (name) values ('Customer name') returning id;
--   insert into public.invitations (workspace_id, email, role, is_admin)
--   values ('<id from the line above>', 'admin@example.org', 'platform_engineer', true);
