-- Migrate: the target cloud and the intake form, with its confirmation. Run once in the Supabase SQL editor.
-- Safe to run again. Run it before the Worker that includes these changes is deployed.

alter table public.analyses add column if not exists cloud text
  check (cloud is null or cloud in ('google', 'aws', 'azure', 'undecided'));
alter table public.analyses add column if not exists cloud_set_by_email text;
alter table public.analyses add column if not exists cloud_set_at timestamptz;
alter table public.analyses add column if not exists intake jsonb;
alter table public.analyses add column if not exists intake_saved_at timestamptz;
alter table public.analyses add column if not exists intake_confirmed_by_email text;
alter table public.analyses add column if not exists intake_confirmed_at timestamptz;

-- The two new notification kinds.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'analysis_started', 'analysis_complete', 'analysis_failed',
  'privacy_signed_off', 'privacy_withdrawn',
  'model_key_added', 'model_key_removed',
  'comment_added', 'action_added', 'action_done',
  'scope_chosen', 'deeper_ready', 'plan_accepted', 'plan_rejected', 'purposes_approved',
  'cloud_chosen', 'intake_confirmed'));
