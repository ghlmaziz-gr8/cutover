-- Run once in the Supabase SQL editor. The database structure file for an analysis, made by access_metadata.py.
-- Holds table names, field names, types, nullability and row counts only. No row values. Safe to run again.

create table if not exists public.analysis_db_metadata (
  analysis_id   uuid primary key references public.analyses (id) on delete cascade,
  doc           jsonb not null,
  table_count   integer not null check (table_count >= 0),
  field_count   integer not null check (field_count >= 0),
  uploaded_by   text not null,
  uploaded_at   timestamptz not null default now()
);

alter table public.analysis_db_metadata enable row level security;
revoke all on public.analysis_db_metadata from anon, authenticated;
grant select, insert, update, delete on public.analysis_db_metadata to service_role;
