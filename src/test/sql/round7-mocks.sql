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
