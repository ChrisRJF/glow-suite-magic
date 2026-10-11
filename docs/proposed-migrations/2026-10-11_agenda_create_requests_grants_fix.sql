-- PROPOSED (step 3A follow-up). NOT applied to production. Requires separate written approval.
-- Run as ONE transaction (psql -1).
--
-- Cause: in production, ALTER DEFAULT PRIVILEGES of role postgres in schema public gives every new table
--   anon/authenticated/service_role = arwdDxtm and sandbox_exec = ar. The 3A migration revoked
--   PUBLIC/anon/authenticated and only ADDED grants for service_role, so service_role kept UPDATE,
--   TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
-- Fix: reduce service_role to exactly SELECT, INSERT, DELETE (as designed).
--   The function create_appointment_atomic_as is SECURITY DEFINER (owner postgres) and keeps working.
-- Not touched: sandbox_exec (platform-managed role, same "ar" on every public table; purpose not ours to change),
--   postgres (owner), any other table, function or default privilege.

REVOKE ALL ON public.agenda_create_requests FROM service_role;
GRANT SELECT, INSERT, DELETE ON public.agenda_create_requests TO service_role;

DO $v$
DECLARE _p text;
BEGIN
  IF NOT (has_table_privilege('service_role', 'public.agenda_create_requests', 'SELECT')
      AND has_table_privilege('service_role', 'public.agenda_create_requests', 'INSERT')
      AND has_table_privilege('service_role', 'public.agenda_create_requests', 'DELETE')) THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: service_role lost a required privilege';
  END IF;
  FOREACH _p IN ARRAY ARRAY['UPDATE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('service_role', 'public.agenda_create_requests', _p) THEN
      RAISE EXCEPTION 'agenda_create_requests_grants_fix: service_role still has %', _p;
    END IF;
  END LOOP;
  IF current_setting('server_version_num')::int >= 170000
     AND has_table_privilege('service_role', 'public.agenda_create_requests', 'MAINTAIN') THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: service_role still has MAINTAIN';
  END IF;
  IF has_table_privilege('anon', 'public.agenda_create_requests', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.agenda_create_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: app roles have access';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: function privileges changed unexpectedly';
  END IF;
END $v$;

-- Rollback: GRANT UPDATE ON public.agenda_create_requests TO service_role; (not needed by any code path)
