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
REVOKE ALL ON FUNCTION public.finish_manual_confirmation(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_manual_confirmation(uuid, integer, text, text) TO service_role;