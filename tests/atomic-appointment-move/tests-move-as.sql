-- move_appointment_atomic_as: real SQL tests on a throwaway local DB, fictional salons only.
\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set T2 '22222222-2222-2222-2222-222222222222'
\set M1 '33333333-3333-3333-3333-333333333333'
\set R1 '55555555-5555-5555-5555-555555555555'
\set X1 '66666666-6666-6666-6666-666666666666'
\set EA 'e0000000-0000-0000-0000-00000000000a'
\set EB 'e0000000-0000-0000-0000-00000000000b'
\set SVC 'a0000000-0000-0000-0000-000000000060'
\set G '90000000-0000-4000-8000-000000000001'
\set G1 'b1000000-0000-0000-0000-000000000001'
\set G2 'b1000000-0000-0000-0000-000000000002'
\set P1 'b1000000-0000-0000-0000-000000000003'
\set S1 'b1000000-0000-0000-0000-000000000004'
\set SIG 'public.move_appointment_atomic_as(uuid,uuid,text,text,uuid,timestamptz)'
INSERT INTO appointments (id,user_id,service_id,appointment_date,start_time,end_time,employee_id,status,booking_group_id) VALUES
 (:'G1',:'T1',:'SVC','2026-11-02 08:00Z','09:00','10:00',:'EB','gepland',:'G'),
 (:'G2',:'T1',:'SVC','2026-11-02 08:00Z','09:00','10:00',:'EA','gepland',:'G'),
 (:'P1',:'T1',:'SVC','2026-11-03 10:00Z','11:00','12:00',:'EB','gepland',NULL),
 (:'S1',:'T1',:'SVC','2026-11-03 08:00Z','09:00','10:00',:'EA','gepland',NULL);
INSERT INTO appointment_employees (user_id,appointment_id,employee_id,is_primary) VALUES
 (:'T1',:'G1',:'EB',true),(:'T1',:'G2',:'EA',true),(:'T1',:'P1',:'EB',true),(:'T1',:'S1',:'EA',true);
INSERT INTO sub_appointments (parent_appointment_id,user_id,person_name,service_id) VALUES (:'S1',:'T1','Sam',:'SVC');
SELECT md5(string_agg(to_jsonb(a)::text,'|' ORDER BY id)) AS g2snap FROM appointments a WHERE id=:'G2' \gset
SELECT md5(string_agg(employee_id::text,'|' ORDER BY id)) AS g2links FROM appointment_employees WHERE appointment_id=:'G2' \gset

-- P: privileges
SELECT t_ok(has_function_privilege('service_role',:'SIG','EXECUTE'), 'P01 service_role can execute');
SELECT t_ok(NOT has_function_privilege('authenticated',:'SIG','EXECUTE') AND NOT has_function_privilege('anon',:'SIG','EXECUTE') AND NOT has_function_privilege('public',:'SIG','EXECUTE'), 'P02 authenticated/anon/PUBLIC denied');
SELECT t_ok(NOT has_function_privilege('authenticated','public.move_appointment_atomic(uuid,text,text,uuid,timestamptz)','EXECUTE'), 'P03 no browser grant on inner move RPC');

-- D: denied actors, no writes
BEGIN; SET LOCAL ROLE service_role;
SELECT public.move_appointment_atomic_as(:'M1',:'G1','2026-11-02','10:00',:'EB',t_upd(:'G1'))->>'code' AS c \gset
SELECT t_ok(:'c'='forbidden', 'D01 staff member (medewerker) forbidden');
SELECT public.move_appointment_atomic_as(:'X1',:'G1','2026-11-02','10:00',:'EB',t_upd(:'G1'))->>'code' AS c \gset
SELECT t_ok(:'c'='forbidden', 'D02 ambiguous membership forbidden');
SELECT public.move_appointment_atomic_as(:'T2',:'G1','2026-11-02','10:00',:'EB',t_upd(:'G1'))->>'code' AS c \gset
SELECT t_ok(:'c'='not_found', 'D03 other salon owner sees not_found');
SELECT public.move_appointment_atomic_as(NULL,:'G1','2026-11-02','10:00',:'EB',t_upd(:'G1'))->>'code' AS c \gset
SELECT t_ok(:'c'='invalid_input', 'D04 missing actor refused');
SELECT public.move_appointment_atomic_as(:'T1',:'G1','2026-11-02','10:00',:'EB',NULL)->>'code' AS c \gset
SELECT t_ok(:'c'='missing_version', 'D05 missing version refused');
RESET ROLE;
SELECT t_ok((SELECT appointment_date='2026-11-02 08:00Z' FROM appointments WHERE id=:'G1'), 'D06 nothing written by denied calls');
ROLLBACK;
ROLLBACK;

-- V: stale
BEGIN; SET LOCAL ROLE service_role;
SELECT public.move_appointment_atomic_as(:'T1',:'G1','2026-11-02','10:00',:'EB','2020-01-01Z')->>'code' AS c \gset
SELECT t_ok(:'c'='stale', 'V01 stale version refused');
ROLLBACK;

-- G: group member moves individually
BEGIN; SET LOCAL ROLE service_role;
SELECT public.move_appointment_atomic_as(:'R1',:'G1','2026-11-02','10:00',:'EB',t_upd(:'G1'))::text AS r \gset
SELECT t_ok(coalesce(current_setting('request.jwt.claim.sub', true),'')='', 'G00 temporary salon identity restored');
RESET ROLE;
SELECT t_ok((:'r'::jsonb->>'code')='moved' AND (:'r'::jsonb->>'booking_group_id')=:'G', 'G01 receptionist moves group member; group echoed');
SELECT t_ok((SELECT appointment_date='2026-11-02 09:00Z' AND booking_group_id=:'G' FROM appointments WHERE id=:'G1'), 'G02 moved row keeps group');
SELECT t_ok((SELECT md5(string_agg(to_jsonb(a)::text,'|' ORDER BY id)) FROM appointments a WHERE id=:'G2')=:'g2snap', 'G03 sibling row byte-identical');
SELECT t_ok((SELECT md5(string_agg(employee_id::text,'|' ORDER BY id)) FROM appointment_employees WHERE appointment_id=:'G2')=:'g2links', 'G04 sibling links untouched');
SELECT t_ok((SELECT count(*)=1 FROM appointment_employees WHERE appointment_id=:'G1' AND employee_id=:'EB'), 'G05 own single link kept');
ROLLBACK;

-- C: conflict / M: multi / S: sub
BEGIN; SET LOCAL ROLE service_role;
SELECT public.move_appointment_atomic_as(:'T1',:'G1','2026-11-03','11:00',:'EB',t_upd(:'G1'))->>'code' AS c \gset
SELECT t_ok(:'c'='conflict', 'C01 occupied slot refused');
SELECT public.move_appointment_atomic_as(:'T1','a1000000-0000-0000-0000-000000000005','2026-11-02','13:00',:'EB',t_upd('a1000000-0000-0000-0000-000000000005'))->>'code' AS c \gset
SELECT t_ok(:'c'='multi_employee_unsupported', 'M01 two employee links refused');
SELECT public.move_appointment_atomic_as(:'T1',:'S1','2026-11-03','13:00',:'EA',t_upd(:'S1'))->>'code' AS c \gset
SELECT t_ok(:'c'='sub_appointments_unsupported', 'S01 appointment with sub-appointments refused');
RESET ROLE;
SELECT t_ok((SELECT count(*)=2 FROM appointment_employees WHERE appointment_id='a1000000-0000-0000-0000-000000000005'), 'M02 both links still present');
ROLLBACK;

-- F: flag off
BEGIN; UPDATE tenant_feature_flags SET atomic_agenda_enabled=false WHERE tenant_id=:'T1'; SET LOCAL ROLE service_role;
SELECT public.move_appointment_atomic_as(:'T1',:'G1','2026-11-02','10:00',:'EB',t_upd(:'G1'))->>'code' AS c \gset
SELECT t_ok(:'c'='disabled', 'F01 flag off disabled');
ROLLBACK;

-- R: forced failure after the write rolls back everything
CREATE FUNCTION t_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.appointment_id='b1000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
CREATE TRIGGER t_boom BEFORE INSERT ON appointment_employees FOR EACH ROW EXECUTE FUNCTION t_boom();
\set ON_ERROR_STOP 0
BEGIN; SET LOCAL ROLE service_role;
SELECT public.move_appointment_atomic_as(:'T1',:'G1','2026-11-02','11:00',:'EB',t_upd(:'G1'));
ROLLBACK;
\set ON_ERROR_STOP 1
DROP TRIGGER t_boom ON appointment_employees;
SELECT t_ok((SELECT appointment_date='2026-11-02 08:00Z' FROM appointments WHERE id=:'G1') AND (SELECT count(*)=1 FROM appointment_employees WHERE appointment_id=:'G1'), 'R01 failure mid-write: row and link unchanged');
