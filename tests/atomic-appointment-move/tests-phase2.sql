\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set T2 '22222222-2222-2222-2222-222222222222'
\set EA 'e0000000-0000-0000-0000-00000000000a'
\set EB 'e0000000-0000-0000-0000-00000000000b'
\set EI 'e0000000-0000-0000-0000-00000000000c'
\set EX 'e0000000-0000-0000-0000-0000000000f2'
\set A1 'a1000000-0000-0000-0000-000000000001'
\set A9 'a1000000-0000-0000-0000-000000000009'
\set A10 'a1000000-0000-0000-0000-000000000010'
\set SVC 'a0000000-0000-0000-0000-000000000060'
\set C1 'c0000000-0000-0000-0000-000000000001'
\set C2 'c0000000-0000-0000-0000-000000000002'

-- ===== 4) required version =====
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true);
SELECT updated_at::text AS before FROM appointments WHERE id=:'A1' \gset
SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',NULL)->>'code')='missing_version', 'V01 NULL version refused');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',public.t_upd(:'A1') - interval '1 second')->>'code')='stale', 'V02 old version refused');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','09:00',:'EA',public.t_upd(:'A1') - interval '1 second')->>'code')='stale', 'V03 stale beats noop (checked before noop)');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','09:00',:'EA',public.t_upd(:'A1'))->>'code')='noop', 'V04 noop with correct version');
RESET ROLE;
SELECT t_ok((SELECT updated_at::text = :'before' AND start_time='09:00' FROM appointments WHERE id=:'A1'), 'V01-V04 row untouched');
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true);
SELECT updated_at AS v0 FROM appointments WHERE id=:'A1' \gset
SET LOCAL ROLE authenticated;
SELECT public.move_appointment_atomic(:'A1','2026-10-12','11:00',:'EA',:'v0')::text AS r \gset
SELECT t_ok((:'r'::jsonb->>'code')='moved' AND (:'r'::jsonb->>'updated_at')::timestamptz > :'v0'::timestamptz, 'V05 move returns new version');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','13:00',:'EA',:'v0')->>'code')='stale', 'V05 second move with old version refused');
SELECT public.move_appointment_atomic(:'A1','2026-10-12','13:00',:'EA',(:'r'::jsonb->>'updated_at')::timestamptz)::text AS r2, public.t_upd(:'A1')::text AS u, (:'r'::jsonb->>'updated_at') AS ru \gset
\echo DBG :r2 :u :ru
SELECT t_ok((:'r2'::jsonb->>'code')='moved', 'V05 second move with new version ok');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.move_appointment_atomic('a1000000-0000-0000-0000-000000000001','2026-10-12','11:00',NULL);
  RAISE EXCEPTION 'FAIL: 4-argument call accepted';
EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'PASS: V06 version parameter has no default (4-arg call does not exist)';
END $$;
ROLLBACK;

-- ===== 2) mixed time storage =====
SELECT t_ok((SELECT kind='legacy' AND local_date='2026-10-16' AND s=1410 AND e=1440 FROM public.appointment_busy_candidates('2026-10-16 23:30Z','23:30','00:30',60)), 'L01 legacy 23:30 stays on its own day, end past midnight = 24:00');
SELECT t_ok((SELECT kind='canonical' AND local_date='2026-10-17' AND s=30 FROM public.appointment_busy_candidates('2026-10-16 22:30Z','00:30','01:30',60)), 'L02 real UTC 22:30Z = 00:30 next local day');
SELECT t_ok((SELECT count(*)=2 AND bool_and(kind='ambiguous') FROM public.appointment_busy_candidates('2026-10-22 09:00Z','10:00','11:00',60)), 'L03 ambiguous row yields both readings');
SELECT t_ok((SELECT count(*)=2 FROM public.appointment_busy_candidates('2026-10-22 09:00Z',NULL,NULL,60)), 'L04 missing start_time is ambiguous');
SELECT t_ok((SELECT kind='canonical' AND local_date='2026-10-26' AND s=540 FROM public.appointment_busy_candidates('2026-10-26 08:00Z','09:00','10:00',60)), 'L05 CET row read correctly');
SELECT t_ok(public.amsterdam_wall_to_utc('2026-10-25','02:30') IS NULL, 'L06 fall-back repeat hour refused');
SELECT t_ok(public.amsterdam_wall_to_utc('2026-03-29','02:30') IS NULL, 'L06 spring-forward gap refused');
SELECT t_ok(public.amsterdam_wall_to_utc('2026-10-25','03:00') = '2026-10-25 02:00Z', 'L06 03:00 after switch = 02:00Z');
SELECT t_ok(public.amsterdam_wall_to_utc('2026-10-25','01:59') = '2026-10-24 23:59Z', 'L06 01:59 before switch = 23:59Z');
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-13','15:30',:'EA',public.t_upd(:'A1'))->>'code')='conflict', 'L07 legacy calendar row blocks overlapping move');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-13','16:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'L07 back-to-back after legacy row ok');
SELECT t_ok((public.move_appointment_atomic(:'A9','2026-10-13','15:00',:'EA',public.t_upd(:'A9'))->>'code')='noop', 'L08 legacy row same slot = noop');
SELECT t_ok((public.move_appointment_atomic(:'A9','2026-10-13','14:00',:'EA',public.t_upd(:'A9'))->>'code')='moved', 'L09 legacy row can be moved');
RESET ROLE;
SELECT t_ok((SELECT appointment_date='2026-10-13 12:00Z' AND start_time='14:00' FROM appointments WHERE id=:'A9'), 'L09 moved row now stored as real UTC');
SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A10','2026-10-23','10:00',NULL,public.t_upd(:'A10'))->>'code')='ambiguous_time', 'L10 ambiguous source row: fail closed');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-22','09:00',:'EA',public.t_upd(:'A1'))->>'code')='conflict', 'L11 ambiguous row blocks UTC reading 09:00');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-22','11:00',:'EA',public.t_upd(:'A1'))->>'code')='conflict', 'L11 ambiguous row blocks local reading 11:00');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-22','13:00',:'EA',public.t_upd(:'A1'))->>'code')='moved', 'L11 free time on that day ok');
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-25','02:30',:'EA',public.t_upd(:'A1'))->>'code')='invalid_local_time', 'L12 move into repeat hour refused');
ROLLBACK;

-- ===== 1) atomic online booking =====
\set common '{"customer_id":"c0000000-0000-0000-0000-000000000001","status":"confirmed","payment_status":"unpaid"}'
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='booked', 'B01 booking succeeds');
SELECT t_ok((SELECT appointment_date='2026-10-16 08:00Z' AND start_time='10:00' AND end_time='11:00' AND employee_id=:'EA' AND user_id=:'T1' AND booking_token::text = (:'r'::jsonb->'appointments'->0->>'booking_token') AND source='online_booking' FROM appointments WHERE id=(:'r'::jsonb->'appointments'->0->>'id')::uuid), 'B01 real UTC, wall clock, tenant from slug, token returned');
SELECT t_ok((SELECT count(*)=1 FROM appointment_employees WHERE appointment_id=(:'r'::jsonb->'appointments'->0->>'id')::uuid AND is_primary), 'B01 employee link in same transaction');
SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:30","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')->>'code')='conflict', 'B02 partial overlap with other start time refused');
SELECT t_ok((SELECT count(*)=1 FROM appointments WHERE start_time IN ('10:00','10:30') AND appointment_date::date='2026-10-16'), 'B02 nothing inserted for refused booking');
ROLLBACK;

-- B03 who may call: anon and authenticated (even the owner) have no EXECUTE
BEGIN; SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.create_public_booking_atomic('salon-een','2026-10-16','[]','{}');
  RAISE EXCEPTION 'FAIL: anon could execute booking RPC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: B03 anon cannot execute booking RPC';
END $$;
ROLLBACK;
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.create_public_booking_atomic('salon-een','2026-10-16','[]','{}');
  RAISE EXCEPTION 'FAIL: authenticated could execute booking RPC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: B03 logged-in user cannot execute booking RPC';
END $$;
DO $$ BEGIN
  PERFORM public.appointment_slot_check(NULL,false,NULL,NULL,0,0,NULL,NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL: helper callable';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: B03 internal slot helper not callable by users';
END $$;
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM public.appointment_slot_check(NULL,false,NULL,NULL,0,0,NULL,NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL: helper callable by service_role';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: B03 internal slot helper not callable by service_role';
END $$;
ROLLBACK;

-- B04 tenant only via slug; forged/foreign input refused, nothing written
BEGIN; SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('bestaat-niet','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060"}]',:'common')->>'code')='not_found', 'B04 unknown slug');
SELECT t_ok((public.create_public_booking_atomic('salon-een''; DROP TABLE appointments;--','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060"}]',:'common')->>'code')='not_found', 'B04 injection in slug');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060"}]','{"customer_id":"c0000000-0000-0000-0000-000000000002"}')->>'code')='invalid_input', 'B04 customer of other salon refused');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-0000000000f2"}]',:'common')->>'code')='invalid_input', 'B04 service of other salon refused');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-0000000000f2"}]',:'common')->>'code')='unknown_employee', 'B04 employee of other salon refused');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"Tino"}]',:'common')->>'code')='invalid_input', 'B04 employee name instead of UUID refused');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060"}]','{"customer_id":"c0000000-0000-0000-0000-000000000001","status":"voltooid"}')->>'code')='invalid_input', 'B04 status outside whitelist refused');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2020-01-06','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060"}]',:'common')->>'code')='slot_unavailable', 'B04 past date refused');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"9:00","service_id":"a0000000-0000-0000-0000-000000000060"}]',:'common')->>'code')='invalid_input', 'B04 bad time format');
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id IS NOT NULL), 'B04 nothing written');
ROLLBACK;

-- B05 booking v2 rules inside the RPC
BEGIN; SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"12:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')->>'code')='in_break', 'B05 break');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-14','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')->>'code')='employee_absent', 'B05 vacation');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-14','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000b"}]',:'common')->>'code')='not_working', 'B05 weekly schedule day off');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000c"}]',:'common')->>'code')='employee_inactive', 'B05 inactive');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-17','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')->>'code')='salon_closed', 'B05 salon closed');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-13','[{"time":"15:30","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')->>'code')='conflict', 'B05 legacy calendar row blocks online booking');
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"15:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')->>'code')='conflict', 'B05 unknown employee name row (Bas) is salon-wide block');
SELECT public.create_public_booking_atomic('salon-een','2026-10-26','[{"time":"09:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='booked' AND (SELECT appointment_date='2026-10-26 08:00Z' FROM appointments WHERE id=(:'r'::jsonb->'appointments'->0->>'id')::uuid), 'B05 CET booking = 08:00Z');
ROLLBACK;

-- B06 groups: all lines + links or nothing
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"},{"time":"11:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000b"}]','{"customer_id":"c0000000-0000-0000-0000-000000000001","source_first":"auto_rebook"}')::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='booked' AND jsonb_array_length(:'r'::jsonb->'appointments')=2, 'B06 group of two booked');
SELECT t_ok((SELECT count(*)=2 AND count(DISTINCT booking_token)=2 AND count(DISTINCT booking_group_id)=1 AND bool_and(booking_group_id IS NOT NULL) FROM appointments WHERE booking_group_id=(:'r'::jsonb->>'booking_group_id')::uuid), 'B06 one group id, own token per line');
SELECT t_ok((SELECT count(*)=2 FROM appointment_employees ae JOIN appointments a ON a.id=ae.appointment_id WHERE a.booking_group_id=(:'r'::jsonb->>'booking_group_id')::uuid), 'B06 both employee links');
SELECT t_ok((SELECT array_agg(source ORDER BY start_time)=ARRAY['auto_rebook','online_booking'] FROM appointments WHERE booking_group_id=(:'r'::jsonb->>'booking_group_id')::uuid), 'B06 rebook source only on first line');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"13:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"},{"time":"13:30","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common')::text AS r \gset
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='conflict' AND (:'r'::jsonb->>'line')='2', 'B07 second line overlaps first line of same group');
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id IS NOT NULL) AND (SELECT count(*)=7 FROM appointment_employees), 'B07 first line and its link rolled back');
SET LOCAL ROLE service_role;
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-12','[{"time":"13:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"},{"time":"10:30","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000b"}]',:'common')->>'code')='conflict', 'B08 second line conflicts with existing appointment');
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id IS NOT NULL), 'B08 whole group rolled back');
ROLLBACK;

-- B09 booking then move into it, and failed link rolls back booking
BEGIN; SET LOCAL ROLE service_role;
SELECT public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]',:'common') IS NOT NULL AS x \gset
RESET ROLE; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-16','10:45',:'EA',public.t_upd(:'A1'))->>'code')='conflict', 'B09 move into online booking (other start) refused');
ROLLBACK;
BEGIN; SELECT set_config('test.fail_link','on', true); SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:00","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":"e0000000-0000-0000-0000-00000000000a"}]','{"customer_id":"c0000000-0000-0000-0000-000000000001"}');
  RAISE EXCEPTION 'FAIL: expected link failure';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT t_ok((SELECT count(*)=0 FROM appointments WHERE customer_id IS NOT NULL), 'B10 link failure: booking row not kept');
ROLLBACK;
