-- Deep file assessment: when a run finished, so the portal can show how long it took.
alter table public.file_deep_assessments add column if not exists finished_at timestamptz;
