-- Lets a workspace save a Google (Gemini) key as well as an Anthropic key. Run once in the Supabase SQL editor.
-- Safe to run again.
alter table public.model_keys drop constraint if exists model_keys_provider_check;
alter table public.model_keys add constraint model_keys_provider_check check (provider in ('anthropic', 'google'));
