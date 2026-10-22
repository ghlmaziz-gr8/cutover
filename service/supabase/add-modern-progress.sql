-- Progress through the modernize stages for each analysis (locked, available, cleared), kept as one JSON value.
-- Run once in the Supabase SQL Editor. Safe to run again.
alter table public.analyses add column if not exists modern_progress jsonb not null default '{}'::jsonb;
