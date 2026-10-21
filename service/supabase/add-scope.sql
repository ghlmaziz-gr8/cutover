-- Scope choice for an analysis. Run once in the Supabase SQL editor.
-- scope: the platform engineer's chosen next stage.
-- deeper_done: set true only when the deeper assessment has finished, which unlocks Modernize and Migrate.

alter table public.analyses add column if not exists scope text
  check (scope is null or scope in ('deeper', 'modernize', 'migrate'));
alter table public.analyses add column if not exists scope_set_by_email text;
alter table public.analyses add column if not exists scope_set_at timestamptz;
alter table public.analyses add column if not exists deeper_done boolean not null default false;
