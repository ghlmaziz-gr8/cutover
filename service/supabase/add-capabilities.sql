-- Capabilities: a named business area above the features of a grouping. Each capability names its features by their
-- position in the groups list. Older groupings have no capabilities (null), and each feature is shown on its own.
alter table public.feature_groupings add column if not exists capabilities jsonb default null;
alter table public.feature_groupings drop constraint if exists feature_groupings_capabilities_check;
alter table public.feature_groupings add constraint feature_groupings_capabilities_check
  check (capabilities is null or (jsonb_typeof(capabilities) = 'array' and length(capabilities::text) <= 40000));

-- The action log accepts every action the Worker writes, including the capability rename.
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
   'model_change', 'redraw_screens', 'screen_delete', 'capability_rename'));
