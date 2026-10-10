-- PROPOSED MIGRATION, NOT APPLIED. Step 4 of the rollout: only AFTER the frontend uses the
-- atomic RPCs for every create/move. Separate written approval required.
-- Purpose: salon users (role authenticated) can no longer write availability-relevant fields
-- directly. Only the SECURITY DEFINER RPCs (running as the function owner) can.
--   * appointments INSERT: blocked, except historical import rows (source='import' and fully in the past)
--   * appointments UPDATE of appointment_date / start_time / end_time / employee_id / user_id / is_demo /
--     service_id, or re-activating a cancelled appointment: blocked
--   * appointment_employees INSERT / UPDATE: blocked (DELETE stays allowed: frees time only)
-- Other updates (status to cancelled, notes, payment fields, confirmation) are unchanged.
-- service_role (Edge Functions) is not affected; see README for those routes.
-- Rollback: DROP TRIGGER appointments_slot_guard ON public.appointments;
--           DROP TRIGGER appointment_employees_slot_guard ON public.appointment_employees;

CREATE OR REPLACE FUNCTION public.appointments_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'import' AND NEW.appointment_date < pg_catalog.now() - interval '1 day' THEN
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
     OR (OLD.status IN ('geannuleerd','cancelled') AND NEW.status NOT IN ('geannuleerd','cancelled')) THEN
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
  IF current_user IN ('authenticated', 'anon') THEN
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
