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
  ai_screens  boolean not null default false,
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
  scope         text check (scope is null or scope in ('deeper', 'modernize', 'migrate')),
  scope_set_by_email text,
  scope_set_at  timestamptz,
  deeper_done   boolean not null default false,
  cloud         text check (cloud is null or cloud in ('google', 'aws', 'azure', 'undecided')),
  cloud_set_by_email text,
  cloud_set_at  timestamptz,
  intake        jsonb,
  intake_saved_at timestamptz,
  intake_confirmed_by_email text,
  intake_confirmed_at timestamptz,
  cost_users    integer check (cost_users is null or (cost_users between 1 and 10000000)),
  cost_users_set_by_email text,
  cost_users_set_at timestamptz,
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
  name          text check (name is null or length(name) <= 200),
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

-- Contingency plans on an analysis: a risk, the fallback if it happens, and how to roll back.
-- Proposals are drafted from the findings in the browser and saved here only when someone accepts or edits them.
-- Every member can read these. Only platform engineers can write them.
create table if not exists public.contingencies (
  id                uuid primary key default gen_random_uuid(),
  analysis_id       uuid not null references public.analyses (id) on delete cascade,
  finding_id        text check (finding_id is null or length(finding_id) <= 200),
  risk              text not null check (length(risk) between 1 and 500),
  contingency       text not null check (length(contingency) between 1 and 2000),
  rollback_step     text check (rollback_step is null or length(rollback_step) <= 2000),
  trigger_condition text check (trigger_condition is null or length(trigger_condition) <= 500),
  owner_email       text check (owner_email is null or length(owner_email) <= 320),
  status            text not null default 'proposed' check (status in ('proposed', 'accepted', 'edited', 'rejected')),
  created_by        uuid references auth.users (id) on delete set null,
  created_by_email  text not null,
  updated_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists contingencies_analysis_idx
  on public.contingencies (analysis_id, created_at);

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
alter table public.contingencies enable row level security;
alter table public.deletion_log enable row level security;

-- Saved notifications for the portal's bell. Written and read only by the Worker.
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  analysis_id   uuid references public.analyses (id) on delete cascade,
  kind          text not null check (kind in (
                  'analysis_started', 'analysis_complete', 'analysis_failed',
                  'privacy_signed_off', 'privacy_withdrawn',
                  'model_key_added', 'model_key_removed',
                  'comment_added', 'action_added', 'action_done',
                  'scope_chosen', 'deeper_ready', 'plan_accepted', 'plan_rejected', 'purposes_approved',
                  'cloud_chosen', 'intake_confirmed', 'terraform_drafted', 'cost_users_set')),
  tone          text not null check (tone in ('info', 'success', 'warning', 'danger', 'ai')),
  title         text not null check (length(title) between 1 and 160),
  body          text not null default '' check (length(body) <= 400),
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

revoke all on public.notifications from anon, authenticated;
revoke all on public.workspaces, public.analyses, public.members, public.invitations,
  public.analysis_comments, public.action_items, public.contingencies, public.deletion_log
  from anon, authenticated;

grant select, insert, update, delete on public.workspaces, public.analyses, public.members,
  public.invitations, public.analysis_comments, public.action_items, public.contingencies to service_role;

-- Database size in bytes, for the operator view. Only the Worker (service role) can call it.
create or replace function public.database_size_bytes()
returns bigint
language sql
security definer
set search_path = ''
as $$ select pg_database_size(current_database())::bigint $$;

revoke all on function public.database_size_bytes() from public, anon, authenticated;
grant execute on function public.database_size_bytes() to service_role;

-- File-level results of an analysis, one row per file. The runner sends them in chunks.
-- Holds no source code and no real data: purpose and suggestions are written as text, and examples are samples.
create table if not exists public.file_findings (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.analyses (id) on delete cascade,
  path         text not null check (length(path) between 1 and 512),
  category     text not null check (length(category) between 1 and 60),
  purpose      text check (purpose is null or length(purpose) <= 2000),
  suggestions  jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  sample_only  boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (analysis_id, path)
);

-- Running total of the file-level results, in bytes, checked against the free-tier cap.
alter table public.analyses add column if not exists file_bytes bigint not null default 0;

alter table public.file_findings enable row level security;
revoke all on public.file_findings from anon, authenticated;
grant select, insert, update, delete on public.file_findings to service_role;

-- Review of each file's purpose and suggestions. A platform engineer approves them, or edits and then approves.
alter table public.file_findings add column if not exists review_status text not null default 'draft'
  check (review_status in ('draft', 'approved', 'edited'));
alter table public.file_findings add column if not exists reviewed_by_email text;
alter table public.file_findings add column if not exists reviewed_at timestamptz;
create index if not exists file_findings_review_idx on public.file_findings (analysis_id, review_status);

-- Who wrote each file's purpose: the rules engine, or the workspace's own model.
alter table public.file_findings add column if not exists purpose_source text not null default 'rules'
  check (purpose_source in ('rules', 'model'));
grant select, insert on public.deletion_log to service_role;

-- Privacy sign-off for a workspace. Append-only: each sign-off or withdrawal is a new row, and the
-- service role may only read and insert. It records who signed, the name typed, the notice version,
-- the exact text shown, and the statements ticked. The Worker writes the text itself, not the browser.
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
-- Supabase gives service_role every privilege on new tables by default. Take back the rest,
-- so sign-off rows can be added and read, but never changed or deleted.
revoke update, delete, truncate, references, trigger on public.privacy_signoffs from service_role;

-- Language model keys a workspace sets up for itself. The key itself is encrypted before it is saved
-- (AES-GCM, with the encryption key held as a Worker secret). Only the last four characters are kept in clear.
-- Removing a key sets revoked_at: rows are never deleted, so the record stays.
create table if not exists public.model_keys (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  provider         text not null check (length(provider) between 1 and 40),
  model            text check (model is null or length(model) between 1 and 120),
  label            text check (label is null or length(label) between 1 and 60),
  base_url         text check (base_url is null or length(base_url) between 1 and 200),
  ciphertext       text not null check (length(ciphertext) between 1 and 1000),
  iv               text not null check (length(iv) between 1 and 100),
  last4            text not null check (length(last4) = 4),
  created_by       uuid references auth.users (id) on delete set null,
  created_by_email text not null check (length(created_by_email) <= 320),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by_email text check (revoked_by_email is null or length(revoked_by_email) <= 320)
);

-- One active key per provider per workspace. Revoked keys do not count.
create unique index if not exists model_keys_one_active_idx
  on public.model_keys (workspace_id, provider) where revoked_at is null and provider <> 'custom';

create index if not exists model_keys_workspace_idx on public.model_keys (workspace_id, created_at desc);

alter table public.model_keys enable row level security;
revoke all on public.model_keys from anon, authenticated, service_role;
grant select, insert, update on public.model_keys to service_role;

-- The model an analysis was run with, and the key it used. Recorded when the analysis starts.
alter table public.analyses add column if not exists model_provider text
  check (model_provider is null or length(model_provider) between 1 and 40);
alter table public.analyses add column if not exists model_key_id uuid references public.model_keys (id) on delete set null;
alter table public.analyses add column if not exists model_notice_version text check (length(model_notice_version) <= 40);
alter table public.analyses add column if not exists model_chosen_by_email text check (length(model_chosen_by_email) <= 320);

-- One-time tokens that let the runner collect an analysis's model key. Only a SHA-256 hash of the token is kept.
-- A token works once, within ten minutes, for one analysis.
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

-- Screens drawn by the workspace's own model from the code. Holds the drawn HTML only, with sample data.
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

-- First workspace admin, after the Worker is deployed. Replace the workspace name and email:
--   insert into public.workspaces (name) values ('Customer name') returning id;
--   insert into public.invitations (workspace_id, email, role, is_admin)
--   values ('<id from the line above>', 'admin@example.org', 'platform_engineer', true);

-- Terraform drafts for Migrate: numbered versions, never overwritten (see add-terraform.sql).
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
