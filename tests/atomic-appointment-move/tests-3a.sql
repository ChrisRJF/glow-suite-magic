-- Step 3A: real SQL tests for create_appointment_atomic_as (fictional salons only).
\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set T2 '22222222-2222-2222-2222-222222222222'
\set M1 '33333333-3333-3333-3333-333333333333'
\set R1 '55555555-5555-5555-5555-555555555555'
\set X1 '66666666-6666-6666-6666-666666666666'
\set EA 'e0000000-0000-0000-0000-00000000000a'
\set EB 'e0000000-0000-0000-0000-00000000000b'
\set SVC 'a0000000-0000-0000-0000-000000000060'
\set C1 'c0000000-0000-0000-0000-000000000001'
\set J1 'd0000000-0000-0000-0000-000000000001'

-- S01 grants: only service_role may call the wrapper; authenticated cannot read the request table
SELECT t_ok(has_function_privilege('service_role','public.create_appointment_atomic_as(uuid,uuid,boolean,uuid,uuid,text,text,uuid[],text,uuid,int,jsonb)','EXECUTE'), 'S01 service_role can execute wrapper');
SELECT t_ok(NOT has_function_privilege('authenticated','public.create_appointment_atomic_as(uuid,uuid,boolean,uuid,uuid,text,text,uuid[],text,uuid,int,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.create_appointment_atomic_as(uuid,uuid,boolean,uuid,uuid,text,text,uuid[],text,uuid,int,jsonb)','EXECUTE'), 'S01 authenticated/anon cannot execute wrapper');
SELECT t_ok(NOT has_table_privilege('authenticated','public.agenda_create_requests','SELECT') AND NOT has_table_privilege('authenticated','public.agenda_create_requests','INSERT'), 'S01 request table not readable/writable by app users');
SELECT t_ok(NOT has_function_privilege('service_role','public.agenda_actor_tenant(uuid)','EXECUTE'), 'S01 helper not directly callable');

-- S02 owner creates; tenant, source, Amsterdam->UTC, link by UUID, journey kept, request row stored
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_appointment_atomic_as(:'T1','10000000-0000-4000-8000-000000000001',true,:'C1',:'SVC','2026-11-02','13:00',ARRAY[:'EA']::uuid[],'eigen notitie',:'J1',2,NULL)::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='created' AND (:'r'::jsonb->>'replay')='false', 'S02 owner create succeeds');
SELECT t_ok((SELECT user_id=:'T1' AND source='manual' AND appointment_date='2026-11-02 12:00Z' AND journey_id=:'J1' FROM appointments WHERE id=(:'r'::jsonb->>'appointment_id')::uuid), 'S02 salon, source manual, CET 13:00 = 12:00Z, journey kept');
SELECT t_ok((SELECT count(*)=1 FROM appointment_employees WHERE appointment_id=(:'r'::jsonb->>'appointment_id')::uuid AND employee_id=:'EA'), 'S02 employee linked by UUID');
SELECT t_ok((SELECT appointment_id=(:'r'::jsonb->>'appointment_id')::uuid AND send_confirmation AND actor_id=:'T1' FROM agenda_create_requests WHERE request_id='10000000-0000-4000-8000-000000000001'), 'S02 request row = same appointment, choice stored');
SELECT t_ok((SELECT count(*)=0 FROM information_schema.columns WHERE table_name='agenda_create_requests' AND column_name IN ('notes','date','time','customer_id','employee_ids')), 'S02 no sensitive request content stored');
SELECT t_ok(coalesce(current_setting('request.jwt.claim.sub', true),'')='', 'S02 salon identity restored after call');
ROLLBACK;

-- S03 receptionist of same salon; staff member and other salon refused
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_appointment_atomic_as(:'R1','10000000-0000-4000-8000-000000000002',false,NULL,:'SVC','2026-11-02','09:00',ARRAY[:'EA',:'EB']::uuid[],'',NULL,NULL,NULL)::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='created' AND (SELECT user_id=:'T1' FROM appointments WHERE id=(:'r'::jsonb->>'appointment_id')::uuid), 'S03 receptie creates in own salon');
SELECT t_ok((SELECT count(*)=2 FROM appointment_employees WHERE appointment_id=(:'r'::jsonb->>'appointment_id')::uuid), 'S03 two employees linked');
SET LOCAL ROLE service_role;
SELECT t_ok((public.create_appointment_atomic_as(:'M1','10000000-0000-4000-8000-000000000003',false,NULL,:'SVC','2026-11-02','15:00','{}','',NULL,NULL,NULL)->>'code')='forbidden', 'S03 medewerker refused');
SELECT t_ok((public.create_appointment_atomic_as(:'X1','10000000-0000-4000-8000-000000000004',false,NULL,:'SVC','2026-11-02','15:00','{}','',NULL,NULL,NULL)->>'code')='forbidden', 'S03 user in two salons (ambiguous) refused');
SELECT t_ok((public.create_appointment_atomic_as(:'T2','10000000-0000-4000-8000-000000000005',false,:'C1',:'SVC','2026-11-02','15:00','{}','',NULL,NULL,NULL)->>'code')='invalid_input', 'S03 other salon owner cannot use salon 1 customer/service');
SELECT t_ok((public.create_appointment_atomic_as(NULL,'10000000-0000-4000-8000-000000000006',false,NULL,:'SVC','2026-11-02','15:00','{}','',NULL,NULL,NULL)->>'code')='invalid_input', 'S03 no actor refused');
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE user_id=:'T2' AND appointment_date>'2026-11-01') AND (SELECT count(*)=1 FROM agenda_create_requests), 'S03 refused calls left no rows');
ROLLBACK;

-- S04 flag off / missing row
BEGIN; UPDATE tenant_feature_flags SET atomic_agenda_enabled=false WHERE tenant_id=:'T1'; SET LOCAL ROLE service_role;
SELECT t_ok((public.create_appointment_atomic_as(:'T1','10000000-0000-4000-8000-000000000007',false,NULL,:'SVC','2026-11-02','15:00','{}','',NULL,NULL,NULL)->>'code')='disabled', 'S04 flag off = disabled');
RESET ROLE; DELETE FROM tenant_feature_flags WHERE tenant_id=:'T1'; SET LOCAL ROLE service_role;
SELECT t_ok((public.create_appointment_atomic_as(:'T1','10000000-0000-4000-8000-000000000008',false,NULL,:'SVC','2026-11-02','15:00','{}','',NULL,NULL,NULL)->>'code')='disabled', 'S04 no flag row = disabled');
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM agenda_create_requests) AND (SELECT count(*)=0 FROM appointments WHERE appointment_date='2026-11-02 14:00Z'), 'S04 nothing written');
ROLLBACK;

-- S05 break, absence, occupied slot, DST: existing checks, nothing stored
BEGIN; SET LOCAL ROLE service_role;
SELECT t_ok((public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000001',false,NULL,:'SVC','2026-10-12','11:45',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)->>'code')='in_break', 'S05 break');
SELECT t_ok((public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000002',false,NULL,:'SVC','2026-10-14','10:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)->>'code')='employee_absent', 'S05 absence');
SELECT t_ok((public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000003',false,NULL,:'SVC','2026-10-12','09:30',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)->>'code')='conflict', 'S05 occupied slot');
SELECT t_ok((public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000004',false,NULL,:'SVC','2026-03-29','02:30','{}','',NULL,NULL,NULL)->>'code')='invalid_local_time', 'S05 DST gap');
SELECT t_ok((public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000005',false,NULL,:'SVC','2026-10-25','02:30','{}','',NULL,NULL,NULL)->>'code')='invalid_local_time', 'S05 DST repeated hour');
SELECT public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000006',false,NULL,:'SVC','2026-03-30','10:00','{}','',NULL,NULL,NULL)::text AS s \gset
SELECT public.create_appointment_atomic_as(:'T1','20000000-0000-4000-8000-000000000007',false,NULL,:'SVC','2026-10-26','10:00','{}','',NULL,NULL,NULL)::text AS w \gset
RESET ROLE;
SELECT t_ok((SELECT count(*)=2 FROM agenda_create_requests), 'S05 refused requests left no request rows (retry possible)');
SELECT t_ok((SELECT appointment_date='2026-03-30 08:00Z' FROM appointments WHERE id=(:'s'::jsonb->>'appointment_id')::uuid) AND (SELECT appointment_date='2026-10-26 09:00Z' FROM appointments WHERE id=(:'w'::jsonb->>'appointment_id')::uuid), 'S05 summer 10:00=08:00Z, winter 10:00=09:00Z');
ROLLBACK;

-- S06 group booking: complete or nothing
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_appointment_atomic_as(:'T1','30000000-0000-4000-8000-000000000001',false,:'C1',:'SVC','2026-11-03','10:00',ARRAY[:'EA']::uuid[],'Groep',NULL,NULL,'[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000060","time":"11:00","employee_id":"e0000000-0000-0000-0000-00000000000b"}]')::text AS g \gset
SELECT public.create_appointment_atomic_as(:'T1','30000000-0000-4000-8000-000000000002',false,:'C1',:'SVC','2026-11-04','10:00',ARRAY[:'EA']::uuid[],'Groep',NULL,NULL,'[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000060"}]')::text AS b \gset
RESET ROLE;
SELECT t_ok((:'g'::jsonb->>'code')='created' AND (:'g'::jsonb->>'booking_group_id') IS NOT NULL, 'S06 group created');
SELECT t_ok((SELECT booking_group_id=(:'g'::jsonb->>'booking_group_id')::uuid FROM agenda_create_requests WHERE request_id='30000000-0000-4000-8000-000000000001'), 'S06 group id stored with request');
SELECT t_ok((:'b'::jsonb->>'code')='group_line_needs_time' AND (SELECT count(*)=0 FROM appointments WHERE appointment_date::date='2026-11-04') AND (SELECT count(*)=0 FROM agenda_create_requests WHERE request_id='30000000-0000-4000-8000-000000000002'), 'S06 invalid group: nothing stored, no request row');
ROLLBACK;

-- S07 replay after COMMIT (lost response), double click, changed content, changed mail choice
SET ROLE service_role;
SELECT public.create_appointment_atomic_as(:'T1','40000000-0000-4000-8000-000000000001',true,NULL,:'SVC','2026-11-05','10:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)::text AS a \gset
SELECT public.create_appointment_atomic_as(:'T1','40000000-0000-4000-8000-000000000001',true,NULL,:'SVC','2026-11-05','10:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)::text AS a2 \gset
SELECT public.create_appointment_atomic_as(:'T1','40000000-0000-4000-8000-000000000001',true,NULL,:'SVC','2026-11-05','11:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)::text AS a3 \gset
SELECT public.create_appointment_atomic_as(:'T1','40000000-0000-4000-8000-000000000001',false,NULL,:'SVC','2026-11-05','10:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)::text AS a4 \gset
SELECT public.create_appointment_atomic_as(:'R1','40000000-0000-4000-8000-000000000001',true,NULL,:'SVC','2026-11-05','10:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)::text AS a5 \gset
RESET ROLE;
SELECT t_ok((:'a2'::jsonb->>'replay')='true' AND (:'a2'::jsonb->>'appointment_id')=(:'a'::jsonb->>'appointment_id') AND (:'a2'::jsonb->>'send_confirmation')='true', 'S07 replay after commit returns same appointment and same mail choice');
SELECT t_ok((:'a3'::jsonb->>'code')='request_mismatch', 'S07 same id, other time refused');
SELECT t_ok((:'a4'::jsonb->>'code')='request_mismatch', 'S07 same id, changed mail choice refused');
SELECT t_ok((:'a5'::jsonb->>'code')='request_mismatch', 'S07 same id from another user of the salon refused');
SELECT t_ok((SELECT count(*)=1 FROM appointments WHERE appointment_date='2026-11-05 09:00Z'), 'S07 exactly one appointment');

-- S08 failed transaction (link insert error) -> nothing kept, then safe retry with same id
BEGIN; SELECT set_config('test.fail_link','on', true); SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM public.create_appointment_atomic_as('11111111-1111-1111-1111-111111111111','50000000-0000-4000-8000-000000000001',false,NULL,'a0000000-0000-0000-0000-000000000060','2026-11-06','10:00',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'',NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL: expected link failure';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE appointment_date='2026-11-06 09:00Z') AND (SELECT count(*)=0 FROM agenda_create_requests WHERE request_id='50000000-0000-4000-8000-000000000001'), 'S08 failure: no appointment, no request row');
SELECT set_config('test.fail_link','off', true); SET LOCAL ROLE service_role;
SELECT public.create_appointment_atomic_as(:'T1','50000000-0000-4000-8000-000000000001',false,NULL,:'SVC','2026-11-06','10:00',ARRAY[:'EA']::uuid[],'',NULL,NULL,NULL)::text AS f \gset
RESET ROLE;
SELECT t_ok((:'f'::jsonb->>'code')='created' AND (:'f'::jsonb->>'replay')='false', 'S08 retry with same id creates once');
ROLLBACK;
