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

-- Final verification: every privilege checked ONE AT A TIME (a comma list in has_table_privilege
-- means "any of", so it can hide a single stray right). has_table_privilege reports EFFECTIVE rights,
-- including rights inherited through role membership and through PUBLIC. The raw ACL is checked too.
DO $v$
DECLARE
  _p text; _r text;
  _tbl constant regclass := 'public.agenda_create_requests'::regclass;
  _all text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  _bad text[] := ARRAY['UPDATE','TRUNCATE','REFERENCES','TRIGGER'];
  _wrap constant text := 'public.create_appointment_atomic_as(uuid, uuid, boolean, uuid, uuid, text, text, uuid[], text, uuid, int, jsonb)';
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    _all := array_append(_all, 'MAINTAIN'); _bad := array_append(_bad, 'MAINTAIN');
  END IF;
  FOREACH _p IN ARRAY ARRAY['SELECT','INSERT','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', _tbl, _p) THEN
      RAISE EXCEPTION 'agenda_create_requests_grants_fix: service_role lacks %', _p;
    END IF;
  END LOOP;
  FOREACH _p IN ARRAY _bad LOOP
    IF has_table_privilege('service_role', _tbl, _p) THEN
      RAISE EXCEPTION 'agenda_create_requests_grants_fix: service_role still has %', _p;
    END IF;
  END LOOP;
  FOREACH _r IN ARRAY ARRAY['public','anon','authenticated'] LOOP
    FOREACH _p IN ARRAY _all LOOP
      IF has_table_privilege(_r, _tbl, _p) THEN
        RAISE EXCEPTION 'agenda_create_requests_grants_fix: % has %', _r, _p;
      END IF;
    END LOOP;
  END LOOP;
  -- raw ACL: no PUBLIC entry (grantee 0), service_role entry exactly SELECT/INSERT/DELETE
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = _tbl AND a.grantee = 0) THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: PUBLIC has a table privilege';
  END IF;
  IF (SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.oid = _tbl AND a.grantee = 'service_role'::regrole) IS DISTINCT FROM 'DELETE,INSERT,SELECT' THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: service_role ACL is not exactly SELECT, INSERT, DELETE';
  END IF;
  IF NOT has_function_privilege('service_role', _wrap, 'EXECUTE')
     OR has_function_privilege('authenticated', _wrap, 'EXECUTE')
     OR has_function_privilege('anon', _wrap, 'EXECUTE') THEN
    RAISE EXCEPTION 'agenda_create_requests_grants_fix: function privileges changed unexpectedly';
  END IF;
END $v$;

-- Rollback: GRANT UPDATE ON public.agenda_create_requests TO service_role; (not needed by any code path)