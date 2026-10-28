-- A business run that fails keeps its row as 'failed', with the reason, so the portal can say so.
-- Run this after add-file-business-run.sql. Until it is run, a failed run is removed as before.

alter table public.file_business_assessments drop constraint if exists file_business_assessments_review_status_check;
alter table public.file_business_assessments add constraint file_business_assessments_review_status_check
  check (review_status in ('running', 'draft', 'approved', 'superseded', 'failed'));
