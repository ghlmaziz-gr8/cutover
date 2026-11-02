-- RFP reviews: the capability list Cutover is matched against, and each RFP's requirements.
-- Only Cutover staff use these tables. Run once in the Supabase SQL editor.

create table if not exists public.cutover_capabilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  status text not null default 'draft',
  updated_by_email text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cutover_capabilities_name_length check (char_length(name) between 2 and 120),
  constraint cutover_capabilities_description_length check (char_length(description) <= 1000),
  constraint cutover_capabilities_status_valid check (status in ('draft', 'approved'))
);

create table if not exists public.rfp_reviews (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text not null default '',
  source_text text not null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  constraint rfp_reviews_title_length check (char_length(title) between 2 and 160),
  constraint rfp_reviews_client_length check (char_length(client) <= 160),
  constraint rfp_reviews_text_length check (char_length(source_text) <= 200000)
);

create table if not exists public.rfp_requirements (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.rfp_reviews(id) on delete cascade,
  position integer not null,
  ref text not null,
  section text not null default '',
  text text not null,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rfp_requirements_text_length check (char_length(text) between 3 and 2000),
  constraint rfp_requirements_section_length check (char_length(section) <= 200),
  constraint rfp_requirements_position_unique unique (review_id, position)
);

create index if not exists rfp_requirements_review_idx on public.rfp_requirements (review_id, position);

alter table public.cutover_capabilities enable row level security;
alter table public.rfp_reviews enable row level security;
alter table public.rfp_requirements enable row level security;

revoke all on public.cutover_capabilities from anon, authenticated;
revoke all on public.rfp_reviews from anon, authenticated;
revoke all on public.rfp_requirements from anon, authenticated;

grant select, insert, update, delete on public.cutover_capabilities to service_role;
grant select, insert, update, delete on public.rfp_reviews to service_role;
grant select, insert, update, delete on public.rfp_requirements to service_role;
