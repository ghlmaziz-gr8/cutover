-- Cutover: move the existing database to workspaces. Run ONCE, in the Supabase SQL editor,
-- before deploying the new Worker.
--
-- All existing data goes into one workspace, "Cutover team" (your test analyses and current members).
-- Old roles are mapped to the new ones:
--   workspace_admin       -> platform_engineer, with admin rights
--   developer             -> platform_engineer
--   application_owner     -> cio_cto
--   compliance_reviewer   -> auditor
-- After this runs, the browser no longer has direct access to any table.

begin;

-- 1. Workspaces
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 200),
  created_at  timestamptz not null default now()
);

insert into public.workspaces (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Cutover team')
on conflict (id) do nothing;

-- 2. Analyses belong to a workspace. Remove the old per-owner browser policies.
alter table public.analyses add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
update public.analyses set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
alter table public.analyses alter column workspace_id set not null;
create index if not exists analyses_workspace_created_idx on public.analyses (workspace_id, created_at desc);
drop policy if exists "analyses: owners insert" on public.analyses;
drop policy if exists "analyses: owners read" on public.analyses;
drop policy if exists "analyses: owners delete" on public.analyses;
revoke all on public.analyses from authenticated;

-- 3. Members: one row per person per workspace, with an admin flag
alter table public.members drop constraint if exists members_role_check;
alter table public.members add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.members add column if not exists is_admin boolean not null default false;
update public.members set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.members set is_admin = true, role = 'platform_engineer' where role = 'workspace_admin';
update public.members set role = 'platform_engineer' where role = 'developer';
update public.members set role = 'cio_cto' where role = 'application_owner';
update public.members set role = 'auditor' where role = 'compliance_reviewer';
alter table public.members drop constraint if exists members_pkey;
alter table public.members add primary key (workspace_id, user_id);
alter table public.members alter column workspace_id set not null;
alter table public.members add constraint members_role_check
  check (role in ('platform_engineer', 'security_officer', 'informatics_lead', 'cio_cto', 'auditor'));
create index if not exists members_user_idx on public.members (user_id);

-- 4. Invitations: per workspace, with an admin flag
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.invitations add column if not exists is_admin boolean not null default false;
update public.invitations set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.invitations set is_admin = true, role = 'platform_engineer' where role = 'workspace_admin';
update public.invitations set role = 'platform_engineer' where role = 'developer';
update public.invitations set role = 'cio_cto' where role = 'application_owner';
update public.invitations set role = 'auditor' where role = 'compliance_reviewer';
alter table public.invitations drop constraint if exists invitations_pkey;
alter table public.invitations add primary key (workspace_id, email);
alter table public.invitations alter column workspace_id set not null;
alter table public.invitations add constraint invitations_role_check
  check (role in ('platform_engineer', 'security_officer', 'informatics_lead', 'cio_cto', 'auditor'));

-- 5. Locks: row-level security on, no browser access, service role only
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.invitations enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_comments enable row level security;
alter table public.action_items enable row level security;
alter table public.deletion_log enable row level security;

revoke all on public.workspaces, public.analyses, public.members, public.invitations,
  public.analysis_comments, public.action_items, public.deletion_log
  from anon, authenticated;

grant select, insert, update, delete on public.workspaces, public.analyses, public.members,
  public.invitations, public.analysis_comments, public.action_items to service_role;

commit;

-- Check after running (expect the workspace and the members you had before):
--   select w.name, m.email, m.role, m.is_admin from public.members m join public.workspaces w on w.id = m.workspace_id;
