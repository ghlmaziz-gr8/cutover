-- Deep file assessment: a run that fails keeps its row with status 'failed' and the reason, so the portal can show it.
alter table public.file_deep_assessments drop constraint if exists file_deep_assessments_status_check;
alter table public.file_deep_assessments add constraint file_deep_assessments_status_check
  check (status in ('running', 'draft', 'approved', 'superseded', 'failed'));
