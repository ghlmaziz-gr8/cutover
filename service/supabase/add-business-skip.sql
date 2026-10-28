-- Skipping a file whose business view failed, and the count on the feature step. Run once in the Supabase SQL Editor.
-- Safe to run again.

-- A failed business view can be skipped for now. The row keeps its reason, and is marked skipped.
alter table public.file_business_assessments drop constraint if exists file_business_assessments_review_status_check;
alter table public.file_business_assessments add constraint file_business_assessments_review_status_check
  check (review_status in ('running', 'draft', 'approved', 'superseded', 'failed', 'skipped'));

-- The action log accepts every action the Worker writes, including the skip.
alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop',
   'retention_delete', 'log_trim',
   'business_start', 'business_finish', 'business_fail', 'business_approve', 'business_supersede', 'business_discard',
   'business_cleanup', 'business_skip',
   'grouping_start', 'grouping_finish', 'grouping_fail', 'grouping_approve', 'grouping_supersede', 'grouping_discard',
   'grouping_reject', 'grouping_edit',
   'stories_start', 'stories_finish', 'stories_fail',
   'deep_file_start', 'deep_file_finish', 'deep_file_fail', 'deep_file_approve', 'deep_file_supersede', 'deep_file_discard',
   'model_change',
   'redraw_screens'));
