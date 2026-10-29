-- Staff: owners and sales people who see the invitation tracker and the heat maps. Super users are the operator
-- list in the Worker's settings, not rows here. Only a super user adds or removes a row.
create table if not exists public.staff (
  email      text primary key check (email = lower(email) and length(email) <= 320),
  role       text not null check (role in ('owner', 'sales')),
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;
grant select, insert, update, delete on public.staff to service_role;

-- Every invitation sent, kept after it is used or removed, so the invitation tracker can show it. Rows hold no
-- personal messages. An invitation is open until it is used (accepted_at) or removed (removed_at).
create table if not exists public.invitation_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null check (email = lower(email) and length(email) <= 320),
  role         text not null check (role in ('platform_engineer', 'security_officer', 'informatics_lead', 'cio_cto', 'auditor')),
  is_admin     boolean not null default false,
  invited_by   uuid references auth.users (id) on delete set null,
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  removed_at   timestamptz
);

create index if not exists invitation_log_open_idx on public.invitation_log (workspace_id, email);

alter table public.invitation_log enable row level security;
revoke all on public.invitation_log from anon, authenticated;
grant select, insert, update, delete on public.invitation_log to service_role;
