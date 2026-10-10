-- Throwaway-DB test for 2026-10-10_employee_weekly_schedule.sql. Fictional data only.
\set ON_ERROR_STOP 1
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
-- Minimal replica of public.employees with tenant RLS (owner = user_id).
create table public.employees (id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, working_days int[] not null default '{1,2,3,4,5}', is_active boolean not null default true);
grant select, insert, update, delete on public.employees to authenticated;
alter table public.employees enable row level security;
create policy own on public.employees for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
insert into public.employees (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Anna Fictief'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Bram Fictief');
create temp table before_rows as select * from public.employees;
