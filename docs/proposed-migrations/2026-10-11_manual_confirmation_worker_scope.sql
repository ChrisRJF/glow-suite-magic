-- PROPOSED (NOT APPLIED). Needs separate approval. Run as ONE transaction (psql -1).
-- Purpose: the mail worker may only fetch rows of one explicitly named salon, and a temporary
-- problem (stop switch, unreadable settings) never uses up the 5 attempts.
-- Touches only the outbox functions; table, trigger, enqueue function and Agenda 3.0 stay unchanged.

-- 1) Per-tenant claim. Rows of other salons are never selected, leased or counted.
--    Deferred rows (pending with a future lease_until) wait until that moment.
CREATE FUNCTION public.claim_manual_confirmations_for_tenant(_tenant_id uuid, _limit integer, _lease_seconds integer)
RETURNS SETOF public.manual_confirmation_outbox
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF _tenant_id IS NULL OR _limit IS NULL OR _limit < 1 OR _limit > 50
     OR _lease_seconds IS NULL OR _lease_seconds < 30 OR _lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  RETURN QUERY
  UPDATE public.manual_confirmation_outbox o
     SET status = 'sending', attempts = o.attempts + 1,
         lease_until = now() + pg_catalog.make_interval(secs => _lease_seconds), updated_at = now()
   WHERE o.appointment_id IN (
     SELECT c.appointment_id FROM public.manual_confirmation_outbox c
      WHERE c.tenant_id = _tenant_id
        AND c.attempts < 5
        AND ((c.status = 'pending' AND (c.lease_until IS NULL OR c.lease_until < now()))
             OR (c.status = 'sending' AND c.lease_until < now()))
      ORDER BY c.created_at
      LIMIT _limit
      FOR UPDATE SKIP LOCKED)
     AND o.tenant_id = _tenant_id
  RETURNING o.*;
END;
$fn$;

-- 2) finish: adds 'defer' (temporary, attempt given back, retry after 5 minutes) and
--    'hold' (provider outcome unknown: not sent, not auto-resent, kept as failed for review).
CREATE OR REPLACE FUNCTION public.finish_manual_confirmation(_appointment_id uuid, _attempt integer, _outcome text, _reason text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE _n integer;
BEGIN
  IF _outcome NOT IN ('sent','skipped','retry','defer','hold') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  UPDATE public.manual_confirmation_outbox o
     SET status = CASE WHEN _outcome = 'sent' THEN 'sent'
                       WHEN _outcome = 'skipped' THEN 'skipped'
                       WHEN _outcome = 'hold' THEN 'failed'
                       WHEN _outcome = 'defer' THEN 'pending'
                       WHEN o.attempts >= 5 THEN 'failed'
                       ELSE 'pending' END,
         attempts = CASE WHEN _outcome = 'defer' THEN GREATEST(o.attempts - 1, 0) ELSE o.attempts END,
         sent_at = CASE WHEN _outcome = 'sent' THEN now() ELSE o.sent_at END,
         last_reason = pg_catalog.left(_reason, 64),
         lease_until = CASE WHEN _outcome = 'defer' THEN now() + interval '5 minutes' ELSE NULL END,
         updated_at = now()
   WHERE o.appointment_id = _appointment_id AND o.status = 'sending' AND o.attempts = _attempt;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$fn$;

-- 3) Rights: only service_role; the old cross-tenant claim is no longer callable by the worker.
REVOKE ALL ON FUNCTION public.claim_manual_confirmations_for_tenant(uuid, integer, integer) FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.claim_manual_confirmations_for_tenant(uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.finish_manual_confirmation(uuid, integer, text, text) FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.finish_manual_confirmation(uuid, integer, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_manual_confirmations(integer, integer) FROM service_role;

DO $v$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','public'] LOOP
    IF has_function_privilege(r, 'public.claim_manual_confirmations_for_tenant(uuid,integer,integer)', 'EXECUTE')
       OR has_function_privilege(r, 'public.finish_manual_confirmation(uuid,integer,text,text)', 'EXECUTE')
       OR has_function_privilege(r, 'public.claim_manual_confirmations(integer,integer)', 'EXECUTE') THEN
      RAISE EXCEPTION 'worker_scope: % can execute', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.claim_manual_confirmations_for_tenant(uuid,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.finish_manual_confirmation(uuid,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'worker_scope: service_role missing execute';
  END IF;
  IF has_function_privilege('service_role', 'public.claim_manual_confirmations(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'worker_scope: old cross-tenant claim still callable';
  END IF;
END
$v$;
