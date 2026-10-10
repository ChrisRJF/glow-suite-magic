-- PROPOSED MIGRATION, NOT APPLIED. Step 4 of the rollout: only AFTER the patched public-booking
-- and the patched frontend are live. Separate written approval required.
-- Purpose: only the SECURITY DEFINER RPCs (running as the function owner) may write
-- availability-relevant fields. This also makes a rollback to an OLD frontend or an OLD
-- public-booking safe: their direct writes fail and nothing is half-written.
--   * appointments INSERT by anon/authenticated/service_role: blocked, except
--       - historical import rows (authenticated, source='import', fully in the past)
--       - demo rows written by service_role (seed-demo-data, is_demo = true)
--   * appointments UPDATE of appointment_date / start_time / end_time / employee_id / service_id /
--     user_id / is_demo by anon/authenticated/service_role: blocked
--   * re-activating a cancelled appointment by anon/authenticated: blocked
--     (service_role status changes from payment webhooks are left alone)
--   * appointment_employees INSERT / UPDATE by anon/authenticated/service_role: blocked
--     (DELETE stays allowed: it only frees time)
-- Notes, cancel, confirmation and payment fields are unchanged.
-- Rollback: DROP TRIGGER appointments_slot_guard ON public.appointments;
--           DROP TRIGGER appointment_employees_slot_guard ON public.appointment_employees;
--   Only allowed while no old frontend / old public-booking is live (see README).

CREATE OR REPLACE FUNCTION public.appointments_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;   -- function owner (inside the atomic RPCs) or a migration
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'authenticated' AND NEW.source = 'import'
       AND NEW.appointment_date < pg_catalog.now() - interval '1 day' THEN
      RETURN NEW;
    END IF;
    IF current_user = 'service_role' AND NEW.is_demo THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'gs:use_create_appointment_atomic';
  END IF;
  IF NEW.appointment_date IS DISTINCT FROM OLD.appointment_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
     OR (current_user <> 'service_role' AND OLD.status IN ('geannuleerd','cancelled') AND NEW.status NOT IN ('geannuleerd','cancelled')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'gs:use_move_appointment_atomic';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.appointment_employees_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'gs:use_atomic_rpc_for_employee_links';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS appointments_slot_guard ON public.appointments;
CREATE TRIGGER appointments_slot_guard
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_slot_guard();

DROP TRIGGER IF EXISTS appointment_employees_slot_guard ON public.appointment_employees;
CREATE TRIGGER appointment_employees_slot_guard
  BEFORE INSERT OR UPDATE ON public.appointment_employees
  FOR EACH ROW EXECUTE FUNCTION public.appointment_employees_slot_guard();

REVOKE ALL ON FUNCTION public.appointments_slot_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appointment_employees_slot_guard() FROM PUBLIC, anon, authenticated;
