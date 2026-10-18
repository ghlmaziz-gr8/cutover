-- Cutover: show each member's name next to their email. Run ONCE, in the Supabase SQL editor,
-- before deploying the new Worker. The name comes from the person's Google profile at sign-in.
alter table public.members add column if not exists name text
  check (name is null or length(name) <= 200);

-- Check after running (expect a row with column name):
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'members' and column_name = 'name';
