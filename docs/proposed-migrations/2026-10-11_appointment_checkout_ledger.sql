-- PROPOSED (not applied). Afrekenen vanuit afspraak: beschermd betalingsgrootboek + claims + per-salon flag.
-- Requires explicit GO before running in production. Run as ONE transaction.
BEGIN;

-- 1. Per-salon gate, default OFF. App users can read their own row (existing policy), never write.
ALTER TABLE public.tenant_feature_flags
  ADD COLUMN IF NOT EXISTS appointment_checkout_enabled boolean NOT NULL DEFAULT false;

-- 2. Ledger: one row per provider-confirmed transaction. Only written by record_provider_payment().
CREATE TABLE public.payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  appointment_id uuid,
  payment_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('viva','mollie')),
  provider_transaction_id text NOT NULL CHECK (length(provider_transaction_id) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('payment','refund')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'EUR'),
  source text NOT NULL CHECK (source IN ('poll','webhook')),
  is_demo boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id, kind)
);
CREATE INDEX payment_ledger_appt_idx ON public.payment_ledger (tenant_id, appointment_id);
REVOKE ALL ON public.payment_ledger FROM PUBLIC, anon, authenticated, service_role, sandbox_exec;
GRANT SELECT ON public.payment_ledger TO service_role;
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;
-- No policies: app users see nothing; service_role bypasses RLS for reads.

-- 3. Claims: one active checkout per appointment+confirmed-paid state (double click / parallel requests).
CREATE TABLE public.appointment_checkout_claims (
  claim_key text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  payment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.appointment_checkout_claims FROM PUBLIC, anon, authenticated, service_role, sandbox_exec;
GRANT SELECT ON public.appointment_checkout_claims TO service_role;
ALTER TABLE public.appointment_checkout_claims ENABLE ROW LEVEL SECURITY;

-- 4. Record provider evidence. Checks salon, payment row, amount and currency; idempotent per transaction.
CREATE OR REPLACE FUNCTION public.record_provider_payment(
  _tenant_id uuid, _payment_id uuid, _provider text, _transaction_id text,
  _kind text, _amount_cents integer, _currency text, _source text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; existing record;
BEGIN
  IF _transaction_id IS NULL OR _amount_cents IS NULL OR _amount_cents <= 0 THEN RETURN 'invalid'; END IF;
  IF upper(coalesce(_currency,'')) <> 'EUR' THEN RETURN 'currency_mismatch'; END IF;
  IF _provider NOT IN ('viva','mollie') OR _kind NOT IN ('payment','refund') OR _source NOT IN ('poll','webhook') THEN RETURN 'invalid'; END IF;
  -- Serialize all evidence for one payment so concurrent poll + webhook cannot both pass the checks below.
  SELECT id, user_id, appointment_id, amount, is_demo INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND OR p.user_id <> _tenant_id THEN RETURN 'tenant_mismatch'; END IF;
  IF _kind = 'payment' AND round(p.amount * 100)::int <> _amount_cents THEN RETURN 'amount_mismatch'; END IF;
  IF _kind = 'payment' AND EXISTS (SELECT 1 FROM public.payment_ledger WHERE payment_id = _payment_id AND kind = 'payment'
       AND NOT (provider = _provider AND provider_transaction_id = _transaction_id)) THEN RETURN 'conflict'; END IF;
  IF _kind = 'refund' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_ledger WHERE payment_id = _payment_id AND kind = 'payment') THEN RETURN 'no_payment'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.payment_ledger WHERE provider = _provider AND provider_transaction_id = _transaction_id AND kind = 'refund')
       AND coalesce((SELECT sum(amount_cents) FROM public.payment_ledger WHERE payment_id = _payment_id AND kind = 'refund'),0) + _amount_cents
           > (SELECT sum(amount_cents) FROM public.payment_ledger WHERE payment_id = _payment_id AND kind = 'payment') THEN RETURN 'amount_mismatch'; END IF;
  END IF;
  SELECT * INTO existing FROM public.payment_ledger
    WHERE provider = _provider AND provider_transaction_id = _transaction_id AND kind = _kind;
  IF FOUND THEN
    IF existing.payment_id = _payment_id AND existing.amount_cents = _amount_cents THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  INSERT INTO public.payment_ledger (tenant_id, appointment_id, payment_id, provider, provider_transaction_id,
    kind, amount_cents, currency, source, is_demo)
  VALUES (_tenant_id, p.appointment_id, _payment_id, _provider, _transaction_id, _kind, _amount_cents, 'EUR', _source, p.is_demo)
  ON CONFLICT (provider, provider_transaction_id, kind) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;
  -- Release the checkout claim so a rest payment can start after a confirmed deposit.
  DELETE FROM public.appointment_checkout_claims WHERE payment_id = _payment_id;
  RETURN 'recorded';
END $$;

-- 4b. Proven totals per appointment (for amount_paid/payment_status; a failed attempt never lowers them).
CREATE OR REPLACE FUNCTION public.appointment_ledger_totals(_tenant_id uuid, _appointment_id uuid)
RETURNS TABLE(paid_cents bigint, refunded_cents bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(amount_cents) FILTER (WHERE kind = 'payment'),0)::bigint,
         coalesce(sum(amount_cents) FILTER (WHERE kind = 'refund'),0)::bigint
  FROM public.payment_ledger WHERE tenant_id = _tenant_id AND appointment_id = _appointment_id;
$$;

-- 5. Atomic claim. Expired claims (failed/abandoned attempt) may be replaced; a live claim never.
CREATE OR REPLACE FUNCTION public.claim_appointment_checkout(_key text, _tenant_id uuid, _appointment_id uuid, _ttl_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.appointment_checkout_claims WHERE claim_key = _key AND expires_at < now();
  INSERT INTO public.appointment_checkout_claims (claim_key, tenant_id, appointment_id, expires_at)
  VALUES (_key, _tenant_id, _appointment_id, now() + make_interval(secs => greatest(60, least(_ttl_seconds, 3600))))
  ON CONFLICT (claim_key) DO NOTHING;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.attach_checkout_claim(_key text, _payment_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.appointment_checkout_claims SET payment_id = _payment_id WHERE claim_key = _key AND payment_id IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.release_checkout_claim(_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.appointment_checkout_claims WHERE claim_key = _key;
$$;

REVOKE ALL ON FUNCTION public.record_provider_payment(uuid,uuid,text,text,text,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_appointment_checkout(text,uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_checkout_claim(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_checkout_claim(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appointment_ledger_totals(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.appointment_ledger_totals(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_payment(uuid,uuid,text,text,text,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_appointment_checkout(text,uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_checkout_claim(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_checkout_claim(text) TO service_role;

COMMIT;
