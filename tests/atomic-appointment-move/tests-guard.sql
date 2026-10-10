\set ON_ERROR_STOP 1
\set T1 '11111111-1111-1111-1111-111111111111'
\set A1 'a1000000-0000-0000-0000-000000000001'
\set A3 'a1000000-0000-0000-0000-000000000003'
-- test-only: give authenticated the direct table rights the live app has (RLS not modelled here)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments, public.appointment_employees TO authenticated;
CREATE FUNCTION public.t_raises(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'no error'; EXCEPTION WHEN insufficient_privilege THEN RETURN SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION public.t_raises(text) TO authenticated, service_role;
-- model of the live owner policies (auth.uid() = user_id), so RLS is not what blocks below
DROP POLICY IF EXISTS t_own_appt ON public.appointments;
DROP POLICY IF EXISTS t_own_link ON public.appointment_employees;
CREATE POLICY t_own_appt ON public.appointments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY t_own_link ON public.appointment_employees FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointments (user_id, appointment_date, start_time, end_time) VALUES ('11111111-1111-1111-1111-111111111111','2026-10-30 08:00Z','10:00','11:00')$q$) LIKE 'gs:use_create%', 'G01 direct future insert blocked');
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointments (user_id, appointment_date, start_time, end_time, source) VALUES ('11111111-1111-1111-1111-111111111111','2026-10-30 08:00Z','10:00','11:00','import')$q$) LIKE 'gs:use_create%', 'G01 future "import" insert blocked');
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointments (user_id, appointment_date, start_time, end_time, source) VALUES ('11111111-1111-1111-1111-111111111111','2024-03-01 09:00Z','10:00','11:00','import')$q$) = 'no error', 'G02 historical import insert (past) still allowed');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET start_time='11:00' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) LIKE 'gs:use_move%', 'G03 direct time change blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET appointment_date=appointment_date + interval '1 day' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) LIKE 'gs:use_move%', 'G03 direct date change blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET employee_id='e0000000-0000-0000-0000-00000000000b' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) LIKE 'gs:use_move%', 'G03 direct employee change blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET status='gepland' WHERE id='a1000000-0000-0000-0000-000000000003'$q$) LIKE 'gs:use_move%', 'G03 re-activating cancelled appointment blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET notes='x', status='geannuleerd' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) = 'no error', 'G04 notes and cancel still allowed');
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointment_employees (user_id, appointment_id, employee_id) VALUES ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-00000000000a')$q$) LIKE 'gs:use_atomic%', 'G05 direct employee link insert blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointment_employees SET employee_id='e0000000-0000-0000-0000-00000000000b' WHERE appointment_id='a1000000-0000-0000-0000-000000000001'$q$) LIKE 'gs:use_atomic%', 'G05 direct employee link update blocked');
ROLLBACK;
-- old public-booking (service_role direct writes) after rollback: blocked; payment updates still ok
GRANT SELECT, INSERT, UPDATE ON public.appointments, public.appointment_employees TO service_role;
BEGIN; SET LOCAL ROLE service_role;
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointments (user_id, appointment_date, start_time, end_time, source) VALUES ('11111111-1111-1111-1111-111111111111','2026-10-30 08:00Z','10:00','11:00','online_booking')$q$) LIKE 'gs:use_create%', 'G06 old public-booking direct insert blocked (live row)');
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointment_employees (user_id, appointment_id, employee_id) VALUES ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-00000000000a')$q$) LIKE 'gs:use_atomic%', 'G06 old public-booking link insert blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET start_time='11:00' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) LIKE 'gs:use_move%', 'G06 service_role time change blocked');
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET payment_status='paid', status='confirmed' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) = 'no error', 'G06 payment webhook status update still allowed');
SELECT t_ok(public.t_raises($q$INSERT INTO public.appointments (user_id, appointment_date, start_time, end_time, is_demo) VALUES ('11111111-1111-1111-1111-111111111111','2026-10-30 08:00Z','10:00','11:00',true)$q$) = 'no error', 'G06 demo seed rows still allowed');
ROLLBACK;
-- old frontend after rollback: legacy applyMove = update + link delete/insert -> first write fails, nothing changed
BEGIN; SELECT set_config('request.jwt.claim.sub', :'T1', true); SET LOCAL ROLE authenticated;
SELECT t_ok(public.t_raises($q$UPDATE public.appointments SET appointment_date='2026-10-12T11:00:00', start_time='11:00', end_time='12:00' WHERE id='a1000000-0000-0000-0000-000000000001'$q$) LIKE 'gs:use_move%', 'G07 old frontend move blocked at first write');
RESET ROLE;
SELECT t_ok((SELECT start_time='09:00' FROM appointments WHERE id=:'A1') AND (SELECT count(*)=1 FROM appointment_employees WHERE appointment_id=:'A1'), 'G07 appointment and link unchanged');
ROLLBACK;
