-- Follow-ups sent after a meeting: one row per person emailed, with who sent it and when. Only the Worker
-- reads and writes this table. Safe to run twice.
create table if not exists public.prospect_followups (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references public.prospects (id) on delete cascade,
  recipient_email text not null check (char_length(recipient_email) <= 320),
  sent_by_email   text not null check (char_length(sent_by_email) <= 320),
  sent_by_name    text,
  message         text,
  sent_at         timestamptz not null default now()
);

create index if not exists prospect_followups_prospect_idx on public.prospect_followups (prospect_id, sent_at desc);

alter table public.prospect_followups enable row level security;
revoke all on public.prospect_followups from anon, authenticated;
grant select, insert, update, delete on public.prospect_followups to service_role;
