\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set T2 '22222222-2222-2222-2222-222222222222'
\set EA 'e0000000-0000-0000-0000-00000000000a'
\set EB 'e0000000-0000-0000-0000-00000000000b'
\set EX 'e0000000-0000-0000-0000-0000000000f2'
\set A1 'a1000000-0000-0000-0000-000000000001'
\set AX 'a2000000-0000-0000-0000-000000000001'
\set SVC 'a0000000-0000-0000-0000-000000000060'
\set C1 'c0000000-0000-0000-0000-000000000001'
INSERT INTO services (id, user_id, name, duration_minutes) VALUES ('a0000000-0000-0000-0000-000000000030', :'T1', 'Kort', 30) ON CONFLICT DO NOTHING;
\set S30 'a0000000-0000-0000-0000-000000000030'

-- K01 group of three: different services/durations, times, employees (two named Tino), all checked + stored
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','10:00',ARRAY[:'EA']::uuid[],'Groep','manual',NULL,NULL,
  '[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000030","time":"11:00","employee_id":"e0000000-0000-0000-0000-00000000000b"},
    {"person_name":"Bo","service_id":"a0000000-0000-0000-0000-000000000060","time":"13:00","employee_id":"e0000000-0000-0000-0000-00000000000b"}]')::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='created' AND jsonb_array_length(:'r'::jsonb->'appointments')=3, 'K01 group of three created');
SELECT t_ok((SELECT array_agg(to_char(start_time,'HH24:MI')||'-'||to_char(end_time,'HH24:MI')||'-'||employee_id ORDER BY start_time) = ARRAY['10:00-11:00-'||:'EA','11:00-11:30-'||:'EB','13:00-14:00-'||:'EB'] FROM appointments WHERE booking_group_id=(:'r'::jsonb->>'booking_group_id')::uuid), 'K01 own time, own duration, employee by UUID per person');
SELECT t_ok((SELECT count(*)=3 AND bool_and(is_primary) FROM appointment_employees ae JOIN appointments a ON a.id=ae.appointment_id WHERE a.booking_group_id=(:'r'::jsonb->>'booking_group_id')::uuid), 'K01 every person linked to its employee');
SELECT t_ok((SELECT count(*)=0 FROM sub_appointments), 'K01 legacy sub_appointments table not used');
SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"11:15","service_id":"a0000000-0000-0000-0000-000000000030","employee_id":"e0000000-0000-0000-0000-00000000000b"}]','{"customer_id":"c0000000-0000-0000-0000-000000000001"}')->>'code')='conflict', 'K01 group member blocks online booking at other start');
ROLLBACK;

-- K02 overlap inside the group (same employee) and with an existing appointment
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','13:00',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,
  '[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000030","time":"13:30","employee_id":"e0000000-0000-0000-0000-00000000000a"}]')::text AS r \gset
SELECT t_ok((:'r'::jsonb->>'code')='conflict' AND (:'r'::jsonb->>'line')='2', 'K02 overlapping group members on one employee refused');
SELECT public.create_appointment_atomic(:'C1',:'S30','2026-10-12','13:00',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,
  '[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000030","time":"13:00","employee_id":"e0000000-0000-0000-0000-00000000000b"},
    {"person_name":"Bo","service_id":"a0000000-0000-0000-0000-000000000060","time":"10:30","employee_id":"e0000000-0000-0000-0000-00000000000b"}]')::text AS r2 \gset
SELECT t_ok((:'r2'::jsonb->>'code')='conflict' AND (:'r2'::jsonb->>'line')='3', 'K02 third member hits existing appointment (other Tino busy 10-11)');
SELECT public.create_appointment_atomic(:'C1',:'S30','2026-10-12','13:00',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,
  '[{"person_name":"Anna","service_id":"a0000000-0000-0000-0000-000000000030","time":"12:00","employee_id":"e0000000-0000-0000-0000-00000000000a"}]')::text AS r3 \gset
SELECT t_ok((:'r3'::jsonb->>'code')='in_break', 'K02 member in break refused');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'S30','2026-10-14','13:00','{}','','manual',NULL,NULL,'[{"person_name":"A","service_id":"a0000000-0000-0000-0000-000000000030","time":"13:00","employee_id":"e0000000-0000-0000-0000-00000000000a"}]')->>'code')='employee_absent', 'K02 member absent refused');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'S30','2026-10-12','13:00','{}','','manual',NULL,NULL,'[{"person_name":"A","service_id":"a0000000-0000-0000-0000-000000000030","time":"15:30","employee_id":"e0000000-0000-0000-0000-00000000000b"}]')->>'code')='outside_working_hours', 'K02 member outside working hours refused');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'S30','2026-10-12','13:00','{}','','manual',NULL,NULL,'[{"person_name":"A","service_id":"a0000000-0000-0000-0000-0000000000f2","time":"14:00"}]')->>'code')='invalid_input', 'K02 member with other salon service refused');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'S30','2026-10-12','13:00','{}','','manual',NULL,NULL,'[{"person_name":"A","service_id":"a0000000-0000-0000-0000-000000000030","time":"14:00","employee_id":"e0000000-0000-0000-0000-0000000000f2"}]')->>'code')='unknown_employee', 'K02 member with other salon employee refused');
SELECT t_ok((public.create_appointment_atomic(:'C1',:'S30','2026-10-12','13:00','{}','','manual',NULL,NULL,'[{"person_name":"A","service_id":"a0000000-0000-0000-0000-000000000030","time":"14:00","employee_id":"Tino"}]')->>'code')='invalid_input', 'K02 member employee given by name refused');
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id=:'C1'), 'K02 no partial group left behind');
ROLLBACK;

-- K03 save error at 2nd and at 3rd member: whole group rolled back
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SELECT set_config('test.fail_link_emp', :'EB', true); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.create_appointment_atomic('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','2026-10-12','13:00',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'','manual',NULL,NULL,
    '[{"person_name":"A","service_id":"a0000000-0000-0000-0000-000000000030","time":"11:00","employee_id":"e0000000-0000-0000-0000-00000000000b"}]');
  RAISE EXCEPTION 'FAIL: expected link failure';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id=:'C1'), 'K03 link error at 2nd member: nothing kept');
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SELECT set_config('test.fail_link_emp', :'EB', true); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.create_appointment_atomic('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','2026-10-12','13:00',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'','manual',NULL,NULL,
    '[{"person_name":"A","service_id":"a0000000-0000-0000-0000-000000000030","time":"14:00"},{"person_name":"B","service_id":"a0000000-0000-0000-0000-000000000030","time":"11:00","employee_id":"e0000000-0000-0000-0000-00000000000b"}]');
  RAISE EXCEPTION 'FAIL: expected link failure';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id=:'C1') AND (SELECT count(*)=7 FROM appointment_employees), 'K03 link error at 3rd member: nothing kept');
ROLLBACK;

-- F01 feature flag: missing row / false / other salon -> disabled, nothing written
BEGIN; UPDATE tenant_feature_flags SET atomic_agenda_enabled=false WHERE tenant_id=:'T1';
SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1'))->>'code')='disabled', 'F01 flag off: move refused');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='disabled', 'F01 flag off: create refused');
RESET ROLE;
SELECT t_ok((SELECT start_time='09:00' FROM appointments WHERE id=:'A1') AND (SELECT count(*)=12 FROM appointments), 'F01 nothing changed');
ROLLBACK;
BEGIN; DELETE FROM tenant_feature_flags WHERE tenant_id=:'T1';
SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1'))->>'code')='disabled', 'F02 missing flag row: move refused');
SELECT t_ok((public.create_appointment_atomic(NULL,:'SVC','2026-10-12','13:00','{}','','manual',NULL,NULL,NULL)->>'code')='disabled', 'F02 missing flag row: create refused');
ROLLBACK;
BEGIN; UPDATE tenant_feature_flags SET atomic_agenda_enabled=false WHERE tenant_id=:'T1';
SELECT set_config('request.jwt.claim.sub', :'T2', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',NULL,public.t_upd(:'A1'))->>'code')='not_found', 'F03 other salon with flag on still cannot touch salon 1');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
DO $$ BEGIN
  UPDATE public.tenant_feature_flags SET atomic_agenda_enabled = true;
  RAISE EXCEPTION 'FAIL: user could change flag';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: F04 salon user cannot switch the flag';
END $$;
ROLLBACK;
BEGIN; UPDATE tenant_feature_flags SET atomic_agenda_enabled=false;
SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]','{"customer_id":"c0000000-0000-0000-0000-000000000001"}')->>'code')='booked', 'F05 online booking keeps working with agenda flag off');
ROLLBACK;

-- E01 move errors: missing employee link, stale, foreign appointment
BEGIN; DELETE FROM appointment_employees WHERE appointment_id=:'A1';
SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'E01 missing link: employee_id UUID column still used, link rebuilt');
RESET ROLE;
SELECT t_ok((SELECT count(*)=1 FROM appointment_employees WHERE appointment_id=:'A1' AND is_primary), 'E01 link restored by the move');
ROLLBACK;
BEGIN; UPDATE appointments SET employee_id='Tino', notes='Medewerker: Tino' WHERE id=:'A1'; DELETE FROM appointment_employees WHERE appointment_id=:'A1';
SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',NULL,public.t_upd(:'A1'))->>'code')='legacy_assignment_requires_choice', 'E02 only a name: never guessed (two Tinos)');
ROLLBACK;
