-- The scope is now one of four combinations, chosen before the deeper assessment runs:
-- deeper, deeper_modernize, deeper_migrate, deeper_modernize_migrate.
-- Run once in the Supabase SQL Editor, after add-scope.sql. Safe to run again.

-- Rows saved under the old single values keep their meaning: modernize and migrate both include the deeper assessment.
alter table public.analyses drop constraint if exists analyses_scope_check;
update public.analyses set scope = 'deeper_modernize' where scope = 'modernize';
update public.analyses set scope = 'deeper_migrate' where scope = 'migrate';
alter table public.analyses add constraint analyses_scope_check
  check (scope is null or scope in ('deeper', 'deeper_modernize', 'deeper_migrate', 'deeper_modernize_migrate'));
