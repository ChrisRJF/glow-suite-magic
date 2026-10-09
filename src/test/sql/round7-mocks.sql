-- TEST-ONLY MOCKS for an empty local PostgreSQL. Never apply anywhere else.
-- Emulates the Supabase roles and auth.uid() the proposal depends on.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role test_intruder nologin;           -- an unrelated DB user
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, test_intruder;
-- Mirrors Supabase default: service_role has table privileges.
alter default privileges in schema public grant all on tables to service_role;
-- Unrelated table used to prove cleanup touches nothing else.
create table public.unrelated_sentinel(id int primary key, created_at timestamptz);
insert into public.unrelated_sentinel values (1, now() - interval '3 years');
-- Round 7.1: mirror of the EXISTING GlowSuite tenant model (fictitious data only).
create type public.app_role as enum ('eigenaar','admin','medewerker','financieel','manager','receptie');
create table public.user_roles(id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null, unique(user_id, role));
create table public.user_access(id uuid primary key default gen_random_uuid(), owner_user_id uuid not null, member_user_id uuid,
  name text not null default '', email text not null, role public.app_role not null, status text not null default 'active',
  is_demo boolean not null default false, unique(owner_user_id, email));
-- public.current_tenant_id() is appended verbatim from supabase/migrations by run-local-pg.sh.
