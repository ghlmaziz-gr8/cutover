-- Retention: 90 days unopened, and trimming the action log. Run once in the Supabase SQL Editor. Safe to run again.

-- When each assessment was last opened (noted at most once an hour).
alter table public.analyses add column if not exists last_opened_at timestamptz;

-- The deletion log gets a reason for assessments removed for not being opened.
alter table public.deletion_log drop constraint if exists deletion_log_reason_check;
alter table public.deletion_log add constraint deletion_log_reason_check check (reason in ('expired', 'requested', 'unopened'));

-- The action log gets the two system actions: retention deletes and log trims.
alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop', 'retention_delete', 'log_trim'));

-- Removes the oldest share of action log entries. Only the Worker (service role) may call it.
-- The table stays append-only for everything else: this function is the one controlled way to trim it.
create or replace function public.purge_oldest_assessment_log(batch_share numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
  n integer;
begin
  select count(*) into total from public.assessment_log;
  n := floor(total * batch_share);
  if n <= 0 then
    return 0;
  end if;
  delete from public.assessment_log
  where id in (select id from public.assessment_log order by created_at asc limit n);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_oldest_assessment_log(numeric) from public, anon, authenticated;
grant execute on function public.purge_oldest_assessment_log(numeric) to service_role;
