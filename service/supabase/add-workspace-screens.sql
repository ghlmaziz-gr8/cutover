-- Run once in the Supabase SQL editor. Lets a workspace admin turn on screens drawn by the workspace's own model.
-- Off by default, so nothing changes until an admin turns it on. Safe to run again.

alter table public.workspaces add column if not exists ai_screens boolean not null default false;
