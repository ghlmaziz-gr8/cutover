-- Google Calendar for Cutover staff. One row per person: the account they connected and their refresh token,
-- encrypted with CUTOVER_KEY_ENCRYPTION_KEY. Only the Worker reads it. Safe to run twice.
create table if not exists public.calendar_connections (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null check (char_length(email) <= 320),
  ciphertext   text not null,
  iv           text not null,
  scope        text not null default '',
  connected_at timestamptz not null default now()
);

alter table public.calendar_connections enable row level security;
revoke all on public.calendar_connections from anon, authenticated;
grant select, insert, update, delete on public.calendar_connections to service_role;
