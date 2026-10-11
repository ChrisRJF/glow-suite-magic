-- PROPOSED (NOT APPLIED): transactional send registration for the manual booking confirmation.
-- Run as ONE transaction (psql -1). Touches nothing that exists except adding one trigger on
-- public.agenda_create_requests. create_appointment_atomic_as, public booking and all existing
-- confirmation mails stay byte-identical.
--
-- How the mail cannot get lost:
--   create_appointment_atomic_as sets agenda_create_requests.appointment_id in the SAME transaction
--   as the appointment. The trigger below inserts the outbox row in that same transaction, so the
--   appointment and the send request commit together or not at all. A lost connection after commit
--   leaves a pending outbox row; a server worker sends it later. Replays (same request_id) never
--   update appointment_id again, so they never add a second row (primary key = appointment_id).

CREATE TABLE public.manual_confirmation_outbox (
  appointment_id uuid PRIMARY KEY,
  tenant_id      uuid        NOT NULL,
  request_id     uuid        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sending','sent','skipped','failed')),
  attempts       integer     NOT NULL DEFAULT 0,
  lease_until    timestamptz,
  last_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);
CREATE INDEX manual_confirmation_outbox_due ON public.manual_confirmation_outbox (status, created_at);

-- Server only. No app role reads or writes it; the worker uses the two functions below.
REVOKE ALL ON public.manual_confirmation_outbox FROM PUBLIC, anon, authenticated, service_role;
-- sandbox_exec is a platform role that may hold default privileges; keep it out too.
REVOKE ALL PRIVILEGES ON TABLE public.manual_confirmation_outbox FROM sandbox_exec;
GRANT SELECT ON public.manual_confirmation_outbox TO service_role;
ALTER TABLE public.manual_confirmation_outbox ENABLE ROW LEVEL SECURITY;
-- no policies on purpose: locked for every non-owner role

CREATE FUNCTION public.enqueue_manual_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.send_confirmation IS TRUE
     AND NEW.appointment_id IS NOT NULL
     AND NEW.appointment_id <> '00000000-0000-0000-0000-000000000000'::uuid
     AND OLD.appointment_id IS DISTINCT FROM NEW.appointment_id THEN
    INSERT INTO public.manual_confirmation_outbox (appointment_id, tenant_id, request_id)
    VALUES (NEW.appointment_id, NEW.tenant_id, NEW.request_id)
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enqueue_manual_confirmation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER agenda_create_requests_enqueue_confirmation
  AFTER UPDATE OF appointment_id ON public.agenda_create_requests
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_manual_confirmation();

-- Worker claim: lease-based, SKIP LOCKED, max 5 attempts. An expired lease (worker crashed) is reclaimed;
-- the same provider idempotency key is reused, so a resend after a crash is not a second mail.
CREATE FUNCTION public.claim_manual_confirmations(_limit integer, _lease_seconds integer)
RETURNS SETOF public.manual_confirmation_outbox
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF _limit IS NULL OR _limit < 1 OR _limit > 50 OR _lease_seconds IS NULL OR _lease_seconds < 30 OR _lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  RETURN QUERY
  UPDATE public.manual_confirmation_outbox o
     SET status = 'sending', attempts = o.attempts + 1,
         lease_until = now() + pg_catalog.make_interval(secs => _lease_seconds), updated_at = now()
   WHERE o.appointment_id IN (
     SELECT c.appointment_id FROM public.manual_confirmation_outbox c
      WHERE c.attempts < 5
        AND (c.status = 'pending' OR (c.status = 'sending' AND c.lease_until < now()))
      ORDER BY c.created_at
      LIMIT _limit
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END;
$fn$;

-- Finish only the attempt you hold (status sending + same attempt number); a stale worker changes nothing.
CREATE FUNCTION public.finish_manual_confirmation(_appointment_id uuid, _attempt integer, _outcome text, _reason text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE _n integer;
BEGIN
  IF _outcome NOT IN ('sent','skipped','retry') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  UPDATE public.manual_confirmation_outbox o
     SET status = CASE WHEN _outcome = 'sent' THEN 'sent'
                       WHEN _outcome = 'skipped' THEN 'skipped'
                       WHEN o.attempts >= 5 THEN 'failed'
                       ELSE 'pending' END,
         sent_at = CASE WHEN _outcome = 'sent' THEN now() ELSE o.sent_at END,
         last_reason = pg_catalog.left(_reason, 64), lease_until = NULL, updated_at = now()
   WHERE o.appointment_id = _appointment_id AND o.status = 'sending' AND o.attempts = _attempt;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_manual_confirmations(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_manual_confirmation(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manual_confirmations(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_manual_confirmation(uuid, integer, text, text) TO service_role;

-- final verification (any deviation aborts the whole transaction)
DO $v$
DECLARE r text; p text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','public'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.manual_confirmation_outbox', p) THEN RAISE EXCEPTION 'outbox: % has %', r, p; END IF;
    END LOOP;
    IF has_function_privilege(r, 'public.claim_manual_confirmations(integer,integer)', 'EXECUTE')
       OR has_function_privilege(r, 'public.finish_manual_confirmation(uuid,integer,text,text)', 'EXECUTE')
       OR has_function_privilege(r, 'public.enqueue_manual_confirmation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'outbox: % can execute', r;
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege('service_role', 'public.manual_confirmation_outbox', p) THEN RAISE EXCEPTION 'outbox: service_role has %', p; END IF;
  END LOOP;
END
$v$;
