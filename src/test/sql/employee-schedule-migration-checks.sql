\set ON_ERROR_STOP 1
-- 1. Existing employees untouched, schedule NULL, still active.
select case when (select count(*) from public.employees e join before_rows b using (id)
  where e.weekly_schedule is null and e.is_active and e.working_days = b.working_days and e.name = b.name) = 2
  then 'PASS existing employees unchanged, weekly_schedule NULL' else 'FAIL existing' end;
-- 2. Owner A saves a valid schedule.
set role authenticated; set test.uid = '00000000-0000-0000-0000-00000000000a';
update public.employees set weekly_schedule = '{"1":{"start":"09:00","end":"16:00"},"2":{"start":"09:00","end":"14:00"}}' where id = '00000000-0000-0000-0000-0000000000a1';
select case when weekly_schedule->'2'->>'end' = '14:00' then 'PASS valid schedule saved' else 'FAIL valid' end from public.employees where id = '00000000-0000-0000-0000-0000000000a1';
-- 3. Tenant isolation: A cannot see or change B.
select case when count(*) = 0 then 'PASS A cannot read B' else 'FAIL read' end from public.employees where id = '00000000-0000-0000-0000-0000000000b1';
update public.employees set weekly_schedule = '{"1":{"start":"09:00","end":"10:00"}}' where id = '00000000-0000-0000-0000-0000000000b1';
reset role;
select case when weekly_schedule is null then 'PASS A cannot write B' else 'FAIL write' end from public.employees where id = '00000000-0000-0000-0000-0000000000b1';
-- 4. Invalid schedules rejected.
\set ON_ERROR_STOP 0
do $$ declare bad jsonb; n int := 0; begin
  foreach bad in array array['[]','"x"','{"8":{"start":"09:00","end":"10:00"}}','{"1":{"start":"16:00","end":"09:00"}}','{"1":{"start":"09:00","end":"09:00"}}','{"1":{"start":"9:00","end":"10:00"}}','{"1":{"start":"09:00"}}','{"1":"09-17"}']::jsonb[] loop
    begin update public.employees set weekly_schedule = bad where id = '00000000-0000-0000-0000-0000000000a1';
    exception when check_violation then n := n + 1; end;
  end loop;
  raise notice '%', case when n = 8 then 'PASS 8/8 invalid schedules rejected' else 'FAIL invalid ' || n || '/8' end;
end $$;
select case when weekly_schedule->'1'->>'end' = '16:00' then 'PASS valid schedule survived invalid attempts' else 'FAIL survived' end from public.employees where id = '00000000-0000-0000-0000-0000000000a1';
-- 5. Clearing back to NULL is allowed.
update public.employees set weekly_schedule = null where id = '00000000-0000-0000-0000-0000000000a1';
select case when weekly_schedule is null then 'PASS schedule can be cleared to NULL' else 'FAIL clear' end from public.employees where id = '00000000-0000-0000-0000-0000000000a1';
