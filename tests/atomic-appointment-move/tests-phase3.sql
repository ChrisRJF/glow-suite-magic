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
SELECT t_ok((public.create_appointment_atomic(:'C1',:'SVC','2026-10-12','10:30',ARRAY[:'EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code')='conflict', 'C04 Tino EA: 10:30-11:30 hits nothing? no: EA free after 10:00 -> see next');
ROLLBACK;
