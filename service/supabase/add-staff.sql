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

-- The personal message sent with an invitation (up to 200 characters). Shown only to staff.
alter table public.invitation_log add column if not exists note text check (note is null or char_length(note) <= 200);

-- One row each time someone signs in after more than 30 minutes away, as in Proof to Profit. Holds no page content.
create table if not exists public.login_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email   text not null,
  at      timestamptz not null default now()
);
create index if not exists login_events_user_idx on public.login_events (user_id, at);

alter table public.login_events enable row level security;
revoke all on public.login_events from anon, authenticated;
grant select, insert, delete on public.login_events to service_role;

