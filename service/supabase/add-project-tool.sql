-- Project tool (Jira) for Cutover users. Each person connects their own Jira site with an API token.
-- The token is encrypted with CUTOVER_KEY_ENCRYPTION_KEY, and only the Worker reads this table.
-- links: remembers which Jira issue each capability, feature and user story became, so a second push
-- updates those issues instead of creating duplicates. Safe to run twice.
create table if not exists public.project_tool_connections (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  tool         text not null default 'jira' check (tool in ('jira')),
  site         text not null check (char_length(site) <= 253),
  email        text not null check (char_length(email) <= 320),
  project_key  text not null check (char_length(project_key) <= 32),
  ciphertext   text not null,
  iv           text not null,
  connected_at timestamptz not null default now()
);

create table if not exists public.project_tool_links (
  grouping_id uuid not null references public.feature_groupings (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  item_key    text not null,
  jira_key    text not null,
  pushed_at   timestamptz not null default now(),
  primary key (grouping_id, user_id, item_key)
);

alter table public.project_tool_connections enable row level security;
alter table public.project_tool_links enable row level security;
revoke all on public.project_tool_connections from anon, authenticated;
revoke all on public.project_tool_links from anon, authenticated;
grant select, insert, update, delete on public.project_tool_connections to service_role;
grant select, insert, update, delete on public.project_tool_links to service_role;
