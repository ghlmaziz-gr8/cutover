-- Adds the notice for an assessment deleted after 90 days unopened. Run once in the Supabase SQL Editor. Safe to run again.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'analysis_started', 'analysis_complete', 'analysis_failed',
  'privacy_signed_off', 'privacy_withdrawn',
  'model_key_added', 'model_key_removed',
  'comment_added', 'action_added', 'action_done',
  'scope_chosen', 'deeper_ready', 'plan_accepted', 'plan_rejected', 'purposes_approved',
  'retention_deleted'));
