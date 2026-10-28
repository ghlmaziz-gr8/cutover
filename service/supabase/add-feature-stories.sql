-- Run once in the Supabase SQL editor. Feature user stories: drafted per feature from the approved rules, kept on the
-- draft grouping. The action list keeps every action added so far. Safe to run again.
alter table public.assessment_log drop constraint if exists assessment_log_action_check;
alter table public.assessment_log add constraint assessment_log_action_check check (action in
  ('start', 'rerun', 'finish', 'fail', 'delete', 'scope', 'convert_start', 'lock_refused', 'stale_stop',
   'retention_delete', 'log_trim',
   'business_start', 'business_finish', 'business_fail', 'business_approve', 'business_supersede', 'business_discard',
   'business_cleanup',
   'grouping_start', 'grouping_finish', 'grouping_fail', 'grouping_approve', 'grouping_supersede', 'grouping_discard',
   'grouping_reject', 'grouping_edit',
   'stories_start', 'stories_finish', 'stories_fail',
   'deep_file_start', 'deep_file_finish', 'deep_file_fail', 'deep_file_approve', 'deep_file_supersede', 'deep_file_discard',
   'model_change'));
