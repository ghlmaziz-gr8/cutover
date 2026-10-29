-- Demo spaces: workspaces that Cutover staff use to show people the portal. Staff see invitations to demo spaces
-- only. Customer workspaces are never shown to Cutover staff unless they are members of them.
-- Safe to run twice. Run after add-platform-roles.sql.
alter table public.workspaces add column if not exists is_demo boolean not null default false;
