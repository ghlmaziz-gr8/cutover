-- Prospects can reschedule or cancel their meeting. Run once in the Supabase SQL editor, after add-prospects.sql.

alter table public.prospects add column if not exists calendar_event_id text;

alter table public.prospects drop constraint if exists prospects_status_valid;
alter table public.prospects add constraint prospects_status_valid
  check (status in ('invited', 'booked', 'cancelled', 'met', 'no_response'));
