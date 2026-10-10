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
SELECT t_ok((public.move_appointment_atomic(:'A1','2026-10-12','13:00',:'EA',(:'r'::jsonb->>'updated_at')::timestamptz)->>'code')='moved', 'V05 second move with new version ok');
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
SELECT t_ok((public.create_public_booking_atomic('salon-een','2026-10-16','[{"time":"10:30","service_id":"a0000000-0000-0000-0000-000000000060","employee_id":null}]',:'common')->>'code')='conflict', 'B02 no-employee booking blocked by employee? no: salon-wide line blocked only by salon-wide rows');
ROLLBACK;
