-- More language model providers, and your own provider with its own address and model name.
-- Run once in the Supabase SQL editor. Safe to run again. Run it before the Worker that includes these changes is deployed.

-- A key can now belong to any provider in the Worker's list (the list is no longer fixed in the database).
alter table public.model_keys drop constraint if exists model_keys_provider_check;
alter table public.model_keys add constraint model_keys_provider_check check (length(provider) between 1 and 40);

-- The model name, and for your own provider, its name and address.
alter table public.model_keys add column if not exists model text
  check (model is null or length(model) between 1 and 120);
alter table public.model_keys add column if not exists label text
  check (label is null or length(label) between 1 and 60);
alter table public.model_keys add column if not exists base_url text
  check (base_url is null or length(base_url) between 1 and 200);

-- A listed provider has one active key per workspace. Your own providers may have several.
drop index if exists public.model_keys_one_active_idx;
create unique index if not exists model_keys_one_active_idx
  on public.model_keys (workspace_id, provider) where revoked_at is null and provider <> 'custom';

-- An analysis records the provider it used, which can now be any provider in the list.
alter table public.analyses drop constraint if exists analyses_model_provider_check;
alter table public.analyses add constraint analyses_model_provider_check check (model_provider is null or length(model_provider) between 1 and 40);
