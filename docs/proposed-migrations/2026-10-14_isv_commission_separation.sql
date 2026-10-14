-- PROPOSED (not applied). Rev 2 (review 2026-10-14): pg_temp in search_path, record_platform_commission, legacy_margin_cents.
-- Separate confidential platform commission from salon-readable payments.
-- Requires explicit GO. Run as ONE transaction. Design: docs/prepared-patches/viva-isv-finance/SECURITY.md
BEGIN;

-- 1. Commission storage: service-role only. Append-only entries so refunds/corrections are new rows.
CREATE TABLE public.platform_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expected','confirmed','reversed','legacy_margin')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  source text NOT NULL CHECK (source IN ('route','viva_webhook','viva_report','legacy_backfill')),
  provider_reference text NOT NULL DEFAULT '',
  is_demo boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, kind, provider_reference)
);
REVOKE ALL ON public.platform_commission_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.platform_commission_entries TO service_role;
ALTER TABLE public.platform_commission_entries ENABLE ROW LEVEL SECURITY;
-- No policies: app users never see a row.

-- 2. Explicit platform owners. Not app_role, not salon roles. Only changed via SQL by the platform.
CREATE TABLE public.platform_owners (
  user_id uuid PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text
);
REVOKE ALL ON public.platform_owners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_owners TO service_role;
ALTER TABLE public.platform_owners ENABLE ROW LEVEL SECURITY;

-- 3. Salons may not write platform keys into payments.metadata (no forging, no hiding).
CREATE OR REPLACE FUNCTION public.guard_platform_payment_metadata()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k text; keys text[] := ARRAY['platform_fee_cents','glowpay_margin_cents','provider_fee_cents',
  'isv_fee_expected_cents','isv_fee_confirmed_cents','isv_fee_reversed_cents','isv_fee_status',
  'isv_fee_reversal_status','legacy_margin_applied','reseller_id','payment_kind'];
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN RETURN NEW; END IF;
  FOREACH k IN ARRAY keys LOOP
    IF TG_OP = 'INSERT' AND coalesce(NEW.metadata,'{}'::jsonb) ? k THEN
      RAISE EXCEPTION 'platform_field_forbidden' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (coalesce(NEW.metadata,'{}'::jsonb) -> k) IS DISTINCT FROM (coalesce(OLD.metadata,'{}'::jsonb) -> k) THEN
      RAISE EXCEPTION 'platform_field_forbidden' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard_platform_metadata BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_payment_metadata();

-- 4. Platform report: owner grant + MFA (aal2), tenant filter from argument only for owners, every call audited.
CREATE OR REPLACE FUNCTION public.platform_finance_report(_period text, _tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tenant_id uuid, gross_cents bigint, refund_cents bigint, net_cents bigint,
  expected_cents bigint, confirmed_cents bigint, reversed_cents bigint, legacy_margin_cents bigint, unconfirmed_count bigint,
  earned_cents bigint, earned_status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_owners o WHERE o.user_id = uid) THEN
    RAISE EXCEPTION 'not_platform_owner' USING ERRCODE = '42501'; END IF;
  IF coalesce(auth.jwt() ->> 'aal','') <> 'aal2' THEN
    RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501'; END IF;
  IF _period !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_period'; END IF;
  INSERT INTO public.audit_logs (user_id, actor_user_id, action, target_type, target_id, details, is_demo)
  VALUES (uid, uid, 'platform_finance_report', 'platform', coalesce(_tenant_id::text,'all'),
          jsonb_build_object('period', _period), false);
  RETURN QUERY
  WITH l AS (
    SELECT pl.tenant_id, pl.payment_id, pl.kind, pl.amount_cents FROM public.payment_ledger pl
    WHERE to_char(pl.created_at AT TIME ZONE 'Europe/Amsterdam','YYYY-MM') = _period
      AND (_tenant_id IS NULL OR pl.tenant_id = _tenant_id) AND pl.is_demo = false),
  paid AS (SELECT DISTINCT l.tenant_id, l.payment_id FROM l WHERE l.kind = 'payment'),
  c AS (SELECT p.tenant_id, p.payment_id,
          sum(e.amount_cents) FILTER (WHERE e.kind='expected') ex,
          sum(e.amount_cents) FILTER (WHERE e.kind='confirmed') cf,
          sum(e.amount_cents) FILTER (WHERE e.kind='reversed') rv,
          sum(e.amount_cents) FILTER (WHERE e.kind='legacy_margin') lg
        FROM paid p JOIN public.platform_commission_entries e ON e.payment_id = p.payment_id
        GROUP BY 1,2)
  SELECT t.tenant_id,
    coalesce(sum(l.amount_cents) FILTER (WHERE l.kind='payment'),0)::bigint,
    coalesce(sum(l.amount_cents) FILTER (WHERE l.kind='refund'),0)::bigint,
    (coalesce(sum(l.amount_cents) FILTER (WHERE l.kind='payment'),0) - coalesce(sum(l.amount_cents) FILTER (WHERE l.kind='refund'),0))::bigint,
    (SELECT coalesce(sum(ex),0) FROM c WHERE c.tenant_id = t.tenant_id)::bigint,
    (SELECT coalesce(sum(cf),0) FROM c WHERE c.tenant_id = t.tenant_id)::bigint,
    (SELECT coalesce(sum(rv),0) FROM c WHERE c.tenant_id = t.tenant_id)::bigint,
    (SELECT coalesce(sum(lg),0) FROM c WHERE c.tenant_id = t.tenant_id)::bigint,
    (SELECT count(*) FROM c WHERE c.tenant_id = t.tenant_id AND c.ex IS NOT NULL AND c.cf IS NULL)::bigint,
    CASE WHEN EXISTS (SELECT 1 FROM c WHERE c.tenant_id = t.tenant_id AND c.ex IS NOT NULL AND c.cf IS NULL) THEN NULL
         ELSE (SELECT coalesce(sum(cf),0) - coalesce(sum(rv),0) FROM c WHERE c.tenant_id = t.tenant_id) END::bigint,
    CASE WHEN EXISTS (SELECT 1 FROM c WHERE c.tenant_id = t.tenant_id AND c.ex IS NOT NULL AND c.cf IS NULL)
         THEN 'partially_unconfirmed' ELSE 'confirmed' END
  FROM (SELECT DISTINCT l.tenant_id FROM l) t JOIN l ON l.tenant_id = t.tenant_id
  GROUP BY t.tenant_id;
END $$;
REVOKE ALL ON FUNCTION public.platform_finance_report(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_finance_report(text, uuid) TO authenticated;

-- 4b. Single write path for commissions (service role only). Tenant and demo flag are derived
--     from the payments row, never from the caller. Idempotent: same key + same amount = 'duplicate';
--     same key + different amount raises, so a mismatch is never silently ignored.
CREATE OR REPLACE FUNCTION public.record_platform_commission(_payment_id uuid, _kind text,
  _amount_cents integer, _source text, _provider_reference text DEFAULT '')
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p record; n int; ref text := coalesce(_provider_reference, '');
BEGIN
  IF _amount_cents IS NULL OR _amount_cents < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT id, user_id, is_demo, amount INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF _amount_cents > round(coalesce(p.amount,0) * 100) THEN RAISE EXCEPTION 'commission_exceeds_payment'; END IF;
  INSERT INTO public.platform_commission_entries (payment_id, tenant_id, kind, amount_cents, source, provider_reference, is_demo)
  VALUES (p.id, p.user_id, _kind, _amount_cents, _source, ref, coalesce(p.is_demo, false))
  ON CONFLICT (payment_id, kind, provider_reference) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN RETURN 'inserted'; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_commission_entries e WHERE e.payment_id = p.id AND e.kind = _kind
             AND e.provider_reference = ref AND e.amount_cents <> _amount_cents) THEN
    RAISE EXCEPTION 'commission_conflict'; END IF;
  RETURN 'duplicate';
END $$;
REVOKE ALL ON FUNCTION public.record_platform_commission(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_commission(uuid, text, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.guard_platform_payment_metadata() FROM PUBLIC, anon, authenticated;

-- 5. LATER, separate GO (data step, not in this transaction): copy legacy platform_fee_cents /
--    glowpay_margin_cents / provider_fee_cents into platform_commission_entries (kind legacy_margin,
--    source legacy_backfill), switch viva-webhook + create-auto-revenue-payment to write there,
--    then strip those keys from payments.metadata as service_role.

COMMIT;
