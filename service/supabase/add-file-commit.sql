-- The commit each file-level result was read at. A draft takes the commit of the run that wrote it.
-- An approved result keeps the commit it was approved at, so the portal can flag one that is older.
alter table public.file_findings add column if not exists commit_sha text check (commit_sha is null or length(commit_sha) <= 64);
