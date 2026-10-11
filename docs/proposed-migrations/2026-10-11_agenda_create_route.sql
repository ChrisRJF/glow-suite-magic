-- PROPOSED (step 3A). NOT applied to production. Requires separate written approval.
-- Prerequisite: 2026-10-10_atomic_appointment_move.sql (already live). Run as ONE transaction (psql -1).
--
-- Adds:
--   1. public.agenda_create_requests: request id -> resulting appointment, written in the SAME
--      transaction as the appointment. No in_progress state exists, so nothing can hang.
--      Stores only ids, a hash of the request and the confirmation choice (no notes, names or times).
--   2. public.create_appointment_atomic_as(_actor, _request_id, ...): service_role only.
--      Resolves the salon for _actor itself (same rule as current_tenant_id), re-checks role,
--      membership and flag, then runs the EXISTING create_appointment_atomic unchanged for that
--      salon (transaction-local identity of the salon owner, restored afterwards).
-- Does NOT change any existing function, table, grant or the public booking path.

CREATE TABLE public.agenda_create_requests (
  tenant_id          uuid        NOT NULL,
  request_id         uuid        NOT NULL,
  actor_id           uuid        NOT NULL,
  body_hash          text        NOT NULL,
  send_confirmation  boolean     NOT NULL,
  appointment_id     uuid        NOT NULL,
  booking_group_id   uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id)
);
COMMENT ON TABLE public.agenda_create_requests IS
  'Idempotency for agenda-create-appointment. Row exists only for committed creates. service_role only.';
REVOKE ALL ON public.agenda_create_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.agenda_create_requests TO service_role;
ALTER TABLE public.agenda_create_requests ENABLE ROW LEVEL SECURITY;
-- no policies: app users can never read or write it

-- Salon for an actor: owner -> own id; otherwise exactly one active membership. NULL = refuse.
CREATE FUNCTION public.agenda_actor_tenant(_actor uuid)
RETURNS TABLE(tenant_id uuid, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _n int;
BEGIN
  IF _actor IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _actor AND r.role = 'eigenaar'::public.app_role) THEN
    tenant_id := _actor; role := 'eigenaar'; RETURN NEXT; RETURN;
  END IF;
  SELECT count(DISTINCT ua.owner_user_id) INTO _n FROM public.user_access ua
   WHERE ua.member_user_id = _actor AND ua.status = 'active';
  IF _n <> 1 THEN RETURN; END IF; -- none or ambiguous: refuse
  RETURN QUERY SELECT ua.owner_user_id, ua.role::text FROM public.user_access ua
   WHERE ua.member_user_id = _actor AND ua.status = 'active'
   ORDER BY ua.created_at LIMIT 1;
END;
$fn$;

CREATE FUNCTION public.create_appointment_atomic_as(
  _actor uuid, _request_id uuid, _send_confirmation boolean,
  _customer_id uuid, _service_id uuid, _date text, _time text, _employee_ids uuid[], _notes text,
  _journey_id uuid, _journey_session int, _sub_appointments jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  _tenant uuid; _role text; _flag boolean; _hash text; _prev text; _r jsonb; _row public.agenda_create_requests%ROWTYPE;
BEGIN
  IF _actor IS NULL OR _request_id IS NULL OR _send_confirmation IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;
  SELECT t.tenant_id, t.role INTO _tenant, _role FROM public.agenda_actor_tenant(_actor) t;
  IF _tenant IS NULL OR _role NOT IN ('eigenaar','admin','manager','receptie') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  -- The owner identity is used for the existing RPC; it must really be an owner.
  IF NOT public.has_any_role(_tenant, ARRAY['eigenaar']::public.app_role[]) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT f.atomic_agenda_enabled INTO _flag FROM public.tenant_feature_flags f WHERE f.tenant_id = _tenant;
  IF _flag IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'disabled');
  END IF;

  _hash := pg_catalog.md5(pg_catalog.jsonb_build_array(_actor, _send_confirmation, _customer_id, _service_id, _date, _time,
            pg_catalog.to_jsonb(_employee_ids), _notes, _journey_id, _journey_session, _sub_appointments)::text);

  -- Replay of a committed request (also after a lost response).
  SELECT * INTO _row FROM public.agenda_create_requests q WHERE q.tenant_id = _tenant AND q.request_id = _request_id;
  IF FOUND THEN
    IF _row.body_hash <> _hash THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'request_mismatch'); END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'created', 'replay', true, 'appointment_id', _row.appointment_id,
      'booking_group_id', _row.booking_group_id, 'send_confirmation', _row.send_confirmation);
  END IF;

  _prev := pg_catalog.current_setting('request.jwt.claim.sub', true);
  BEGIN
    -- Placeholder row first: a concurrent request with the same id waits here on the primary key.
    INSERT INTO public.agenda_create_requests (tenant_id, request_id, actor_id, body_hash, send_confirmation, appointment_id)
    VALUES (_tenant, _request_id, _actor, _hash, _send_confirmation, '00000000-0000-0000-0000-000000000000');
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', _tenant::text, true);
    _r := public.create_appointment_atomic(_customer_id, _service_id, _date, _time, _employee_ids, _notes, 'manual',
                                           _journey_id, _journey_session, _sub_appointments);
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(_prev, ''), true);
    IF COALESCE((_r ->> 'ok')::boolean, false) IS NOT TRUE OR (_r ->> 'appointment_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs3a:refused';
    END IF;
    UPDATE public.agenda_create_requests q
       SET appointment_id = (_r ->> 'appointment_id')::uuid, booking_group_id = NULLIF(_r ->> 'booking_group_id', '')::uuid
     WHERE q.tenant_id = _tenant AND q.request_id = _request_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- the other request committed first; read its committed result
      PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(_prev, ''), true);
      SELECT * INTO _row FROM public.agenda_create_requests q WHERE q.tenant_id = _tenant AND q.request_id = _request_id;
      IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'failed'); END IF;
      IF _row.body_hash <> _hash THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'request_mismatch'); END IF;
      RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'created', 'replay', true, 'appointment_id', _row.appointment_id,
        'booking_group_id', _row.booking_group_id, 'send_confirmation', _row.send_confirmation);
    WHEN raise_exception THEN
      PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(_prev, ''), true);
      IF SQLERRM = 'gs3a:refused' THEN
        RETURN _r; -- refusal code from the existing RPC; request row and any rows rolled back
      END IF;
      RAISE;
  END;
  RETURN _r || pg_catalog.jsonb_build_object('replay', false, 'send_confirmation', _send_confirmation);
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_actor_tenant(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)
  TO service_role;

-- final verification (fails the whole transaction on any stray privilege)
DO $v$
BEGIN
  IF has_function_privilege('authenticated', 'public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agenda_actor_tenant(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.agenda_actor_tenant(uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.agenda_create_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.agenda_create_requests', 'SELECT') THEN
    RAISE EXCEPTION 'agenda_create_route: privilege check failed';
  END IF;
END $v$;

-- Rollback (no appointment is lost):
--   REVOKE EXECUTE ON FUNCTION public.create_appointment_atomic_as(...) FROM service_role;
--   The table and created appointments stay; the browser agenda keeps working on today's code when the flag is off.
