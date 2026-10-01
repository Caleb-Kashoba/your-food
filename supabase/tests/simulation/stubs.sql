-- Éléments de Supabase absents d'un PostgreSQL ordinaire, juste de quoi rejouer les migrations
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth;
create schema extensions;
create extension pgcrypto schema extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(), instance_id uuid, aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create publication supabase_realtime;
create schema cron;
create table cron.job (jobname text);
create function cron.schedule(text, text, text) returns bigint language sql as $$ insert into cron.job values ($1); select 1::bigint $$;
-- Droits par défaut comme sur Supabase : les rôles de l'API peuvent tout sur le schéma public, la sécurité par ligne et les fonctions filtrent
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
