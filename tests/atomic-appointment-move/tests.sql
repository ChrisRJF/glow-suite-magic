\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set T2 '22222222-2222-2222-2222-222222222222'
\set M1 '33333333-3333-3333-3333-333333333333'
\set T4 '44444444-4444-4444-4444-444444444444'
\set EA 'e0000000-0000-0000-0000-00000000000a'
\set EB 'e0000000-0000-0000-0000-00000000000b'
\set EI 'e0000000-0000-0000-0000-00000000000c'
\set ED 'e0000000-0000-0000-0000-00000000000d'
\set EX 'e0000000-0000-0000-0000-0000000000f2'
\set A1 'a1000000-0000-0000-0000-000000000001'
\set A3 'a1000000-0000-0000-0000-000000000003'
\set A4 'a1000000-0000-0000-0000-000000000004'
\set A5 'a1000000-0000-0000-0000-000000000005'
\set AX 'a2000000-0000-0000-0000-000000000001'
\set A4T4 'a4000000-0000-0000-0000-000000000001'

-- helper: run one call as user :u, result into :r
-- usage: \set u ... then the BEGIN/SELECT block

-- T01 success, same employee, new time; end time and UTC instant correct (CEST)
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1'))::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='moved', 'T01 move succeeds');
SELECT t_ok((SELECT appointment_date = '2026-10-12 09:00Z' AND start_time='11:00' AND end_time='12:00' AND employee_id=:'EA' FROM appointments WHERE id=:'A1'), 'T01 date/time/employee_id written');
SELECT t_ok((SELECT count(*)=1 AND bool_and(employee_id=:'EA' AND is_primary) FROM appointment_employees WHERE appointment_id=:'A1'), 'T01 one primary link');
ROLLBACK;

-- T02 same name, different id: move to the OTHER Tino (EB) by UUID
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.move_appointment_atomic(:'A1','2026-10-12','13:00',:'EB',public.t_upd(:'A1'))::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='moved', 'T02 move to second Tino');
SELECT t_ok((SELECT count(*)=1 AND bool_and(employee_id=:'EB') FROM appointment_employees WHERE appointment_id=:'A1'), 'T02 link points to EB, EA link removed');
SELECT t_ok((SELECT employee_id=:'EB' FROM appointments WHERE id=:'A1'), 'T02 appointments.employee_id = EB (public-booking sees it)');
ROLLBACK;

-- T03 overlap with EB 10:00-11:00 (partial and exact); adjacent end is fine
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','10:30',:'EB',public.t_upd(:'A1'))->>'code')='conflict', 'T03 partial overlap blocked');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','10:00',:'EB',public.t_upd(:'A1'))->>'code')='conflict', 'T03 exact overlap blocked');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EB',public.t_upd(:'A1'))->>'code')='moved', 'T03 back-to-back after 11:00 allowed');
ROLLBACK;

-- T04 break 12:00-12:30 for EA (fully and partially overlapping)
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','12:00',:'EA',public.t_upd(:'A1'))->>'code')='in_break', 'T04 drop on break');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:30',:'EA',public.t_upd(:'A1'))->>'code')='in_break', 'T04 60 min running into break');
ROLLBACK;

-- T05 weekly schedule EB (ma/di 09-14)
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','13:30',:'EB',public.t_upd(:'A1'))->>'code')='outside_working_hours', 'T05 ends after 14:00');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-14','10:00',:'EB',public.t_upd(:'A1'))->>'code')='not_working', 'T05 Wednesday not in schedule');
ROLLBACK;

-- T06 legacy NULL schedule (EA): working_days + opening hours; Saturday closed
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-16','17:30',:'EA',public.t_upd(:'A1'))->>'code')='outside_working_hours', 'T06 past closing 18:00');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-17','10:00',:'EA',public.t_upd(:'A1'))->>'code')='salon_closed', 'T06 Saturday disabled');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-16','17:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'T06 Friday 17:00-18:00 ok');
ROLLBACK;

-- T07 custom hours 13:00-17:00 on 13 Oct replace the window
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-13','10:00',:'EA',public.t_upd(:'A1'))->>'code')='outside_working_hours', 'T07 outside custom hours');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-13','13:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'T07 inside custom hours');
ROLLBACK;

-- T08 absences: full-day vacation, partial absence, status sick window
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-14','10:00',:'EA',public.t_upd(:'A1'))->>'code')='employee_absent', 'T08 vacation day');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-15','10:30',:'EA',public.t_upd(:'A1'))->>'code')='employee_absent', 'T08 partial absence 10-11');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-19','10:00',:'EA',public.t_upd(:'A1'))->>'code')='employee_absent', 'T08 status ziek');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-15','11:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'T08 after partial absence ok');
ROLLBACK;

-- T09 cross-tenant
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T2', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EX',public.t_upd(:'A1'))->>'code')='not_found', 'T09 other salon cannot move T1 appointment');
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EX',public.t_upd(:'A1'))->>'code')='unknown_employee', 'T09 cannot assign other salon employee');
SELECT t_ok((public.move_appointment_atomic(:'AX','2026-10-12','11:00',NULL,public.t_upd(:'AX'))->>'code')='not_found', 'T09 cannot move other salon appointment');
ROLLBACK;

-- T10 forged / unknown / inactive / not qualified
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(gen_random_uuid(),'2026-10-12','11:00',:'EA',public.t_upd(gen_random_uuid()))->>'code')='not_found', 'T10 unknown appointment');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',gen_random_uuid(),public.t_upd(:'A1'))->>'code')='unknown_employee', 'T10 unknown employee');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EI',public.t_upd(:'A1'))->>'code')='employee_inactive', 'T10 inactive employee');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'ED',public.t_upd(:'A1'))->>'code')='not_qualified', 'T10 employee without this service');
ROLLBACK;

-- T11 roles: staff member of T1 and owner with only 'financieel' are denied
BEGIN; SELECT set_config('request.jwt.claim.sub', :'M1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1'))->>'code')='not_found', 'T11 medewerker denied');
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T4', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A4T4','2026-10-12','11:00',NULL,public.t_upd(:'A4T4'))->>'code')='not_found', 'T11 financieel-only owner denied');
ROLLBACK;

-- T12 unauthenticated and anon
BEGIN; SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1'))->>'code')='not_authenticated', 'T12 no identity');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.move_appointment_atomic('a1000000-0000-0000-0000-000000000001','2026-10-12','11:00',NULL,public.t_upd('a1000000-0000-0000-0000-000000000001'));
  RAISE EXCEPTION 'FAIL: anon could execute';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: T12 anon has no EXECUTE';
END $$;
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  UPDATE public.appointments SET start_time='11:00';
  RAISE EXCEPTION 'FAIL: direct table write allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: T12 RPC needs no direct table grant (fixture grants none)';
END $$;
ROLLBACK;

-- T13 cancelled appointment
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A3','2026-10-12','11:00',NULL,public.t_upd(:'A3'))->>'code')='invalid_status', 'T13 cancelled cannot move');
ROLLBACK;

-- T14 no-op on own slot: nothing written
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true);
SELECT updated_at::text AS before FROM appointments WHERE id=:'A1' \gset
SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','09:00',:'EA',public.t_upd(:'A1'))->>'code')='noop', 'T14 same slot is noop');
RESET ROLE;
SELECT t_ok((SELECT updated_at::text = :'before' FROM appointments WHERE id=:'A1'), 'T14 row untouched');
ROLLBACK;

-- T15 bogus input incl. injection strings
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-02-30','10:00',:'EA',public.t_upd(:'A1'))->>'code')='invalid_input', 'T15 impossible date');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','9:00',:'EA',public.t_upd(:'A1'))->>'code')='invalid_input', 'T15 time not HH:MM');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','09:10',:'EA',public.t_upd(:'A1'))->>'code')='invalid_input', 'T15 off 15-min grid');
SELECT t_ok((public.move_appointment_atomic(:'A1',NULL,'10:00',:'EA',public.t_upd(:'A1'))->>'code')='invalid_input', 'T15 null date');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12''; DROP TABLE appointments;--','10:00',:'EA',public.t_upd(:'A1'))->>'code')='invalid_input', 'T15 injection in date');
ROLLBACK;
SELECT t_ok((SELECT count(*) > 0 FROM appointments), 'T15 table still there');

-- T16 Amsterdam DST: CEST (+2) vs CET (+1), and the spring-forward gap
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT public.move_appointment_atomic(:'A1','2026-10-23','09:00',:'EA',public.t_upd(:'A1'))->>'code' AS c1 \gset
RESET ROLE;
SELECT t_ok(:'c1'='moved' AND (SELECT appointment_date='2026-10-23 07:00Z' FROM appointments WHERE id=:'A1'), 'T16 Fri 23 Oct 09:00 = 07:00Z (CEST)');
SET LOCAL ROLE authenticated;
SELECT public.move_appointment_atomic(:'A1','2026-10-26','09:00',:'EA',public.t_upd(:'A1'))->>'code' AS c2 \gset
RESET ROLE;
SELECT t_ok(:'c2'='moved' AND (SELECT appointment_date='2026-10-26 08:00Z' FROM appointments WHERE id=:'A1'), 'T16 Mon 26 Oct 09:00 = 08:00Z (CET)');
SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-03-29','02:30',:'EA',public.t_upd(:'A1'))->>'code')='invalid_local_time', 'T16 02:30 on 29 Mar does not exist');
ROLLBACK;

-- T17 legacy name-only assignment: never guessed
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A4','2026-10-16','10:00',NULL,public.t_upd(:'A4'))->>'code')='legacy_assignment_requires_choice', 'T17 legacy note needs explicit employee');
SELECT t_ok((public.move_appointment_atomic(:'A4','2026-10-16','10:00',:'EB',public.t_upd(:'A4'))->>'code')='not_working', 'T17 explicit EB still checked (Friday)');
SELECT t_ok((public.move_appointment_atomic(:'A4','2026-10-16','10:00',:'EA',public.t_upd(:'A4'))->>'code')='moved', 'T17 explicit EA by UUID');
ROLLBACK;

-- T18 more than one linked employee: fail closed
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A5','2026-10-16','13:00',:'EA',public.t_upd(:'A5'))->>'code')='multi_employee_unsupported', 'T18 multi-employee blocked');
ROLLBACK;

-- T19 simulated link insert failure: appointment row must stay unchanged
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SELECT set_config('test.fail_link','on', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.move_appointment_atomic('a1000000-0000-0000-0000-000000000001','2026-10-12','11:00','e0000000-0000-0000-0000-00000000000a',public.t_upd('a1000000-0000-0000-0000-000000000001'));
  RAISE EXCEPTION 'FAIL: expected link failure';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT t_ok((SELECT start_time='09:00' AND appointment_date='2026-10-12 07:00Z' FROM appointments WHERE id=:'A1'), 'T19 appointment unchanged after link failure');
SELECT t_ok((SELECT count(*)=1 AND bool_and(employee_id=:'EA') FROM appointment_employees WHERE appointment_id=:'A1'), 'T19 old link restored (delete rolled back)');
ROLLBACK;

-- T20 optimistic check
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA','2000-01-01Z',public.t_upd(:'A1'))->>'code')='stale', 'T20 stale updated_at refused');
ROLLBACK;

-- T21 unknown employee text ("Bas") blocks the whole salon
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','15:00',:'EA',public.t_upd(:'A1'))->>'code')='conflict', 'T21 legacy "Bas" appointment = salon-wide block');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','16:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'T21 cancelled 16:00 appointment does not block');
ROLLBACK;

-- T22 search_path hardening: temp objects cannot shadow anything
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
CREATE TEMP TABLE appointments (id uuid, user_id uuid);
CREATE TEMP TABLE employees (id uuid);
SET LOCAL search_path = pg_temp, public;
SELECT t_ok((public.move_appointment_atomic('a1000000-0000-0000-0000-000000000001','2026-10-12','11:00','e0000000-0000-0000-0000-00000000000a',public.t_upd('a1000000-0000-0000-0000-000000000001'))->>'code')='moved', 'T22 temp tables ignored');
RESET ROLE; RESET search_path;
SELECT t_ok((SELECT ('search_path=""' = ANY(proconfig) OR 'search_path=' = ANY(proconfig)) AND prosecdef FROM pg_proc WHERE proname='move_appointment_atomic'), 'T22 function pinned to empty search_path');
SELECT t_ok(NOT has_function_privilege('anon','public.move_appointment_atomic(uuid,text,text,uuid,timestamptz,public.t_upd(uuid))','EXECUTE'), 'T22 anon has no EXECUTE');
ROLLBACK;

-- T23 unassigned target still checks opening hours and salon-wide blocks
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','15:30',NULL,public.t_upd(:'A1'))->>'code')='conflict', 'T23 unassigned blocked by salon-wide appointment');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','17:30',NULL,public.t_upd(:'A1'))->>'code')='outside_working_hours', 'T23 unassigned past closing');
ROLLBACK;
