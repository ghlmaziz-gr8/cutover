-- Language model keys a workspace sets up for itself. The key itself is encrypted before it is saved
-- (AES-GCM, with the encryption key held as a Worker secret). Only the last four characters are kept in clear.
-- Removing a key sets revoked_at: rows are never deleted, so the record stays.
create table if not exists public.model_keys (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  provider         text not null check (provider in ('anthropic')),
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
  on public.model_keys (workspace_id, provider) where revoked_at is null;

create index if not exists model_keys_workspace_idx on public.model_keys (workspace_id, created_at desc);

alter table public.model_keys enable row level security;
revoke all on public.model_keys from anon, authenticated, service_role;
grant select, insert, update on public.model_keys to service_role;
