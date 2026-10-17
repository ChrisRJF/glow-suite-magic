-- PROPOSED (Atomic Agenda punt 1, stap 2). NOT applied. NOT executed. Requires separate DB/permissions GO.
-- Prerequisites (already live): move_appointment_atomic, agenda_actor_tenant, create_appointment_atomic_as model.
-- Run as ONE transaction (psql -1) only after review.
--
-- public.move_appointment_atomic_as(_actor, ...): service_role only (server route), never authenticated/anon.
--  * Actor comes from server-verified auth.getUser in the route, never from the request body.
--  * Salon + role resolved here via agenda_actor_tenant; flag re-checked here.
--  * Group members (booking_group_id) move INDIVIDUALLY: only this row changes; booking_group_id,
--    siblings and their employee links are never touched (the existing move RPC does not write them).
--  * Refused BEFORE any write: foreign/missing row, >1 employee link, any sub_appointments
--    (parent+sub timing has no proven contract), plus all existing move_appointment_atomic checks.
--  * Lock order equals move_appointment_atomic: slot advisory lock (target date) -> row FOR UPDATE.
--    Advisory xact locks are re-entrant, so the inner RPC re-acquires without deadlock.
-- Does NOT change existing functions, tables, grants or the legacy browser move.

CREATE FUNCTION public.move_appointment_atomic_as(
  _actor uuid, _appointment_id uuid, _target_date text, _target_start text,
  _target_employee_id uuid, _expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  _tenant uuid; _role text; _flag boolean; _a public.appointments%ROWTYPE;
  _links int; _subs int; _prev text; _r jsonb;
BEGIN
  IF _actor IS NULL OR _appointment_id IS NULL OR _target_date IS NULL OR _target_start IS NULL
     OR _target_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;
  IF _expected_updated_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'missing_version');
  END IF;
  SELECT t.tenant_id, t.role INTO _tenant, _role FROM public.agenda_actor_tenant(_actor) t;
  IF _tenant IS NULL OR _role NOT IN ('eigenaar','admin','manager','receptie') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF NOT public.has_any_role(_tenant, ARRAY['eigenaar']::public.app_role[]) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT f.atomic_agenda_enabled INTO _flag FROM public.tenant_feature_flags f WHERE f.tenant_id = _tenant;
  IF _flag IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'disabled');
  END IF;

  -- Same lock order as move_appointment_atomic.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment_slot:' || _tenant::text || ':' || _target_date, 0));
  SELECT * INTO _a FROM public.appointments WHERE id = _appointment_id AND user_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF _a.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'stale');
  END IF;

  -- Lock link/sub rows so the checks hold until commit (writers that INSERT new rows: see BLOCKERS).
  PERFORM 1 FROM public.appointment_employees ae WHERE ae.appointment_id = _a.id FOR UPDATE;
  SELECT count(*)::int INTO _links FROM public.appointment_employees ae WHERE ae.appointment_id = _a.id;
  IF _links > 1 THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'multi_employee_unsupported'); END IF;
  -- New sub_appointments rows cannot appear concurrently: their FK takes FOR KEY SHARE on the parent,
  -- which waits for the FOR UPDATE row lock above until this transaction ends.
  SELECT count(*)::int INTO _subs FROM public.sub_appointments s WHERE s.parent_appointment_id = _a.id;
  IF _subs > 0 THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'sub_appointments_unsupported'); END IF;

  _prev := pg_catalog.current_setting('request.jwt.claim.sub', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _tenant::text, true);
  BEGIN
    _r := public.move_appointment_atomic(_appointment_id, _target_date, _target_start,
                                         _target_employee_id, _expected_updated_at);
  EXCEPTION WHEN others THEN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(_prev, ''), true);
    RAISE;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(_prev, ''), true);

  -- Defence in depth: a concurrently committed extra link (no FK on appointment_employees) aborts all writes.
  IF COALESCE((_r ->> 'ok')::boolean, false) AND
     (SELECT count(*) FROM public.appointment_employees ae WHERE ae.appointment_id = _a.id) > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs_move:links_changed';
  END IF;
  -- Group membership must be unchanged after the move (defence in depth).
  IF (SELECT x.booking_group_id FROM public.appointments x WHERE x.id = _a.id) IS DISTINCT FROM _a.booking_group_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs_move:group_changed';
  END IF;
  RETURN _r || pg_catalog.jsonb_build_object('booking_group_id', _a.booking_group_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.move_appointment_atomic_as(uuid, uuid, text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_appointment_atomic_as(uuid, uuid, text, text, uuid, timestamptz) TO service_role;
COMMENT ON FUNCTION public.move_appointment_atomic_as(uuid, uuid, text, text, uuid, timestamptz) IS
  'Server-only agenda move for a verified actor. Group members move individually. Proposed 2026-10-17, not applied.';

-- BLOCKERS before activation:
--  0. appointment_employees has NO foreign key to appointments (checked read-only 2026-10-17), so a
--     concurrent INSERT of a link is not blocked by the row lock; the post-check only catches links
--     committed before our check. Closing this needs either an FK (schema change, separate GO) or
--     removal of all legacy link writers for the salon before activation.
--  1. Legacy browser writers (CalendarPage.applyMove, dossier edits) insert appointment_employees /
--     sub_appointments without this lock; FOR UPDATE does not stop new INSERTs. Activation per salon
--     only when that salon has no legacy writers left (atomic mode replaces applyMove entirely).
--  3. Local PG lock/rollback tests (concurrent move vs booking, stale, group sibling untouched).
