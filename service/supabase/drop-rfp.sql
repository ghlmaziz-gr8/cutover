-- Removes the RFP review tables and all their data. Run once in the Supabase SQL editor.
-- Child table first, because rfp_requirements refers to rfp_reviews.
drop table if exists public.rfp_requirements;
drop table if exists public.rfp_reviews;
drop table if exists public.cutover_capabilities;
