\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set M1 '33333333-3333-3333-3333-333333333333'
\set T4 '44444444-4444-4444-4444-444444444444'
\set EA 'e0000000-0000-0000-0000-00000000000a'
\set EB 'e0000000-0000-0000-0000-00000000000b'
\set EX 'e0000000-0000-0000-0000-0000000000f2'
\set A1 'a1000000-0000-0000-0000-000000000001'
\set SVC 'a0000000-0000-0000-0000-000000000060'
\set SVC2 'a0000000-0000-0000-0000-0000000000f2'
\set C1 'c0000000-0000-0000-0000-000000000001'
\set C2 'c0000000-0000-0000-0000-000000000002'
\set J1 'd0000000-0000-0000-0000-000000000001'

-- C01-C04 agenda create through the RPC
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','13:00',ARRAY[:'EA']::uuid[],'Medewerker: Tino','manual',:'J1',2,NULL)::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='created', 'C01 agenda create succeeds');
SELECT t_ok((SELECT appointment_date='2026-10-12 11:00Z' AND start_time='13:00' AND end_time='14:00' AND employee_id=:'EA' AND source='manual' AND journey_id=:'J1' AND booking_reference IS NOT NULL AND booking_token IS NOT NULL FROM appointments WHERE id=(:'r'::jsonb->>'appointment_id')::uuid), 'C01 stored as real UTC, journey, existing insert trigger ran');
SELECT t_ok((SELECT count(*)=1 AND bool_and(is_primary AND employee_id=:'EA') FROM appointment_employees WHERE appointment_id=(:'r'::jsonb->>'appointment_id')::uuid), 'C01 primary link in same transaction');
SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','13:30',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='conflict', 'C02 overlapping create with other start refused');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','10:30',ARRAY[:'EB']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='conflict', 'C04 other Tino (EB) busy 10-11');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','10:30',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='created', 'C04 same name, other UUID (EA) free: created');
ROLLBACK;

-- C03 multi-employee appointment blocks every linked employee
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','13:00',ARRAY[:'EA',:'EB']::uuid[],'','manual',NULL,NULL,NULL)::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='created' AND (SELECT count(*)=2 AND count(*) FILTER (WHERE is_primary)=1 FROM appointment_employees WHERE appointment_id=(:'r'::jsonb->>'appointment_id')::uuid), 'C03 two employees linked, one primary');
SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"13:15","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000b"}]','{"customer_id":"c0000000-0000-0000-0000-000000000001"}')->>'code')='conflict', 'C03 second linked employee blocked for online booking');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic((:'r'::jsonb->>'appointment_id')::uuid,'2026-10-12','15:00',:'EA',(:'r'::jsonb->>'updated_at')::timestamptz)->>'code')='multi_employee_unsupported', 'C03 multi-employee appointment not moved by guessing');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','16:00',ARRAY[:'EA',:'EB']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='outside_working_hours', 'C03 every employee checked (EB stops at 14:00)');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','16:00',ARRAY[:'EA',:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='invalid_input', 'C03 duplicate employee refused');
ROLLBACK;

-- C05 roles and identity
BEGIN; SELECT set_config('request.jwt.claim.sub', :'M1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='not_found', 'C05 medewerker cannot create');
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T4', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(NULL,'a0000000-0000-0000-0000-0000000000f4','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='not_found', 'C05 financieel cannot create');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='not_authenticated', 'C05 no identity');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.create_appointment_atomic(NULL,'a0000000-0000-0000-0000-000000000060','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL: anon could create';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: C05 anon has no EXECUTE on create';
END $$;
ROLLBACK;

-- C06 other salon's data refused, nothing written
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC2','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='invalid_input', 'C06 service of other salon');
SELECT t_ok((public.create_appointment_atomic(:'C2',:'SVC','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='invalid_input', 'C06 customer of other salon');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','13:00',ARRAY[:'EX']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='unknown_employee', 'C06 employee of other salon');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-12','13:00','{}','','manual',:'J1',1,NULL)->>'code')='invalid_input', 'C06 journey of another customer');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','13:00','{}','','import',NULL,NULL,NULL)->>'code')='invalid_input', 'C06 source import not allowed here');
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id IS NOT NULL OR source IS NOT NULL), 'C06 nothing written');
ROLLBACK;

-- C07 werktijden / afwezigheid / pauze / sluiting / zomertijd
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-14','10:00',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='employee_absent', 'C07 vacation');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-15','10:30',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='employee_absent', 'C07 partial absence');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-12','11:45',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='in_break', 'C07 break');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-13','10:00',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='outside_working_hours', 'C07 custom hours day');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-14','10:00',ARRAY[:'EB']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='not_working', 'C07 weekly schedule day off');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-17','10:00','{}','','manual',NULL,NULL,NULL)->>'code')='salon_closed', 'C07 salon closed');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-25','02:30','{}','','manual',NULL,NULL,NULL)->>'code')='invalid_local_time', 'C07 repeat hour');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-03-29','02:30','{}','','manual',NULL,NULL,NULL)->>'code')='invalid_local_time', 'C07 DST gap');
SELECT public.create_appointment_atomic(NULL,:'SVC','2026-10-26','09:00',ARRAY[:'EA']::uuid[],'','waitlist',NULL,NULL,NULL)::text AS r \gset
RESET ROLE;
SELECT t_ok((SELECT appointment_date='2026-10-26 08:00Z' AND source='waitlist' FROM appointments WHERE id=(:'r'::jsonb->>'appointment_id')::uuid), 'C07 CET create = 08:00Z, waitlist source kept');
ROLLBACK;

-- C08 group (sub appointments) all or nothing; C09 link failure rolls back
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.create_appointment_atomic(:'C1',:'SVC','2026-10-16','10:00',ARRAY[:'EA']::uuid[],'Groepsboeking','manual',NULL,NULL,'[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000060"},{"person_name":"Bo","service_id":"a0000000-0000-0000-0000-000000000060","assignment_mode":"auto"}]')::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='created' AND (SELECT count(*)=2 FROM sub_appointments WHERE parent_appointment_id=(:'r'::jsonb->>'appointment_id')::uuid), 'C08 group with two sub appointments');
SET LOCAL ROLE authenticated;
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-16','11:00',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,'[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000060"},{"person_name":"Cas","service_id":"a0000000-0000-0000-0000-0000000000f2"}]')->>'code')='invalid_input', 'C08 bad sub line refused');
RESET ROLE;
SELECT t_ok((SELECT count(*)=1 FROM appointments WHERE customer_id=:'C1') AND (SELECT count(*)=2 FROM sub_appointments), 'C08 refused group left nothing behind');
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SELECT set_config('test.fail_link','on', true); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.create_appointment_atomic(NULL,'a0000000-0000-0000-0000-000000000060','2026-10-16','10:00',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'','manual',NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL: expected link failure';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE start_time='10:00' AND appointment_date='2026-10-16 08:00Z'), 'C09 link failure: no appointment kept');
ROLLBACK;

-- M01 midnight: 24:00 representation, explicit refusal of slots past closing
SELECT t_ok(public.minutes_to_wall_time(1440) = '24:00'::time AND public.minutes_to_wall_time(1439) = '23:59'::time AND public.minutes_to_wall_time(1441) IS NULL, 'M01 1440 minutes = 24:00, never 23:59');
SELECT t_ok((SELECT e=1440 FROM public.appointment_busy_candidates('2026-10-16 21:00Z','23:00','24:00',60)), 'M01 end 24:00 read as end of day');
SELECT t_ok((SELECT e=1440 FROM public.appointment_busy_candidates('2026-10-16 21:00Z','23:00','00:00',60)), 'M01 end 00:00 read as end of day (old rows)');
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-16','23:00',:'EA',public.t_upd(:'A1'))->>'code')='outside_working_hours', 'M01 move ending 24:00 explicitly refused');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-16','23:15','{}','','manual',NULL,NULL,NULL)->>'code')='outside_working_hours', 'M01 create crossing midnight refused');
ROLLBACK;
