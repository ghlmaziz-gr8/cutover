-- Prospects: people a sales or admin person invites to a meeting. Prospects never log in.
-- Run once in the Supabase SQL editor.

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text not null,
  last_name text not null,
  company text not null,
  phone text,
  invited_by uuid references auth.users(id) on delete set null,
  invited_by_email text not null,
  invited_at timestamptz not null default now(),
  last_email_at timestamptz,
  status text not null default 'invited',
  meeting_at timestamptz,
  constraint prospects_status_valid check (status in ('invited', 'booked', 'met', 'no_response'))
);

create index if not exists prospects_invited_at_idx on public.prospects (invited_at desc);

alter table public.prospects enable row level security;
revoke all on public.prospects from anon, authenticated;
grant select, insert, update, delete on public.prospects to service_role;
