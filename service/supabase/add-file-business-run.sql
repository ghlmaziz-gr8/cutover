-- The business assessment run: a row is 'running' while the runner works on a file, then becomes a draft.
-- The action log also records when a run starts. Run this after add-file-business.sql.

alter table public.file_business_assessments drop constraint if exists file_business_assessments_review_status_check;
alter table public.file_business_assessments add constraint file_business_assessments_review_status_check
  check (review_status in ('running', 'draft', 'approved', 'superseded'));

alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop',
   'retention_delete', 'log_trim',
   'business_start', 'business_finish', 'business_fail', 'business_approve', 'business_supersede', 'business_discard'));
