-- Where people click: anonymous click positions per screen, read back as heat maps by workspace admins.
-- A row keeps the workspace, the screen, a button name from the page's own list (or nothing), the position as a
-- whole percentage of the screen and the width class. It never keeps who clicked, text, field values or page content.
-- Rows older than 30 days are removed by the daily retention run.
create table if not exists public.ui_clicks (
  id          bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  screen      text not null check (char_length(screen) <= 40),
  target      text check (target is null or char_length(target) <= 40),
  x           smallint not null check (x between 0 and 100),
  y           smallint not null check (y between 0 and 100),
  width_class text not null check (width_class in ('phone', 'tablet', 'desktop')),
  created_at  timestamptz not null default now()
);

create index if not exists ui_clicks_workspace_screen_idx on public.ui_clicks (workspace_id, screen, created_at);

alter table public.ui_clicks enable row level security;
revoke all on public.ui_clicks from anon, authenticated;
grant select, insert, delete on public.ui_clicks to service_role;
