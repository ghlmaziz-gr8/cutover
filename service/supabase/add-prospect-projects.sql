-- Projects under a prospect, and the emails sent about each one. Run once in the Supabase SQL editor.

create table if not exists public.prospect_projects (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  name text not null,
  summary text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_projects_name_length check (char_length(name) between 2 and 120),
  constraint prospect_projects_summary_length check (summary is null or char_length(summary) <= 1000)
);

create index if not exists prospect_projects_prospect_idx on public.prospect_projects (prospect_id, created_at);

create table if not exists public.project_emails (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.prospect_projects (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  subject text not null,
  recipients text[] not null,
  sent_by_email text not null,
  sent_by_name text,
  note text,
  found text,
  how_helps text,
  cutover_share integer,
  human_hours_saved integer,
  advantages text[] not null default '{}',
  capability_ids text[],
  attachment_names text[] not null default '{}',
  sent_at timestamptz not null default now(),
  constraint project_emails_share_range check (cutover_share is null or cutover_share between 0 and 100),
  constraint project_emails_hours_range check (human_hours_saved is null or human_hours_saved >= 0)
);

create index if not exists project_emails_project_idx on public.project_emails (project_id, sent_at desc);

alter table public.prospect_projects enable row level security;
alter table public.project_emails enable row level security;
revoke all on public.prospect_projects from anon, authenticated;
revoke all on public.project_emails from anon, authenticated;
grant select, insert, update, delete on public.prospect_projects to service_role;
grant select, insert, update, delete on public.project_emails to service_role;
