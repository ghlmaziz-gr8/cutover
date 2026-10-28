-- Drawing the screens again: the action log records it, and each analysis keeps when that run started,
-- so the page can show it working. Run once in the Supabase SQL Editor. Safe to run again.

-- The action log accepts every action the Worker writes, including the new one.
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
   'model_change',
   'redraw_screens'));

-- When the screens were last started to be drawn again. Cleared when the run reports it has finished.
alter table public.analyses add column if not exists screens_started_at timestamptz;
