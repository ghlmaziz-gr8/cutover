-- Modernize cost estimate: the number of users entered by a platform engineer, and a notification kind.
-- Run once in the Supabase SQL editor. Safe to run again. Run it before the Worker that includes these changes is deployed.

alter table public.analyses add column if not exists cost_users integer
  check (cost_users is null or (cost_users between 1 and 10000000));
alter table public.analyses add column if not exists cost_users_set_by_email text;
alter table public.analyses add column if not exists cost_users_set_at timestamptz;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'analysis_started', 'analysis_complete', 'analysis_failed',
  'privacy_signed_off', 'privacy_withdrawn',
  'model_key_added', 'model_key_removed',
  'comment_added', 'action_added', 'action_done',
  'scope_chosen', 'deeper_ready', 'plan_accepted', 'plan_rejected', 'purposes_approved',
  'cloud_chosen', 'intake_confirmed', 'terraform_drafted', 'cost_users_set'));
