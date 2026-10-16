CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE sandbox_exec;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE tenant_feature_flags(tenant_id uuid PRIMARY KEY);
CREATE TABLE settings(user_id uuid, is_demo boolean, demo_mode boolean,salon_name text);
CREATE TABLE customers(id uuid,user_id uuid); CREATE TABLE appointments(id uuid,user_id uuid);
CREATE TABLE glowpay_connected_merchants(user_id uuid,is_demo boolean,viva_merchant_id text);
CREATE TABLE payments(id uuid PRIMARY KEY,user_id uuid,appointment_id uuid,customer_id uuid,amount numeric,is_demo boolean,provider text,currency text,payment_type text,status text,method text,viva_merchant_id text,viva_source_code text,metadata jsonb,checkout_reference text,mollie_payment_id text,paid_at timestamptz,refunded_at timestamptz,refunded_amount numeric);
CREATE TABLE audit_logs(user_id uuid,actor_user_id uuid,action text,target_type text,target_id text,details jsonb,is_demo boolean);
ALTER TABLE public.tenant_feature_flags
  ADD COLUMN IF NOT EXISTS appointment_checkout_enabled boolean NOT NULL DEFAULT false;

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

CREATE OR REPLACE FUNCTION public.record_provider_payment(
  _tenant_id uuid, _payment_id uuid, _provider text, _transaction_id text,
  _kind text, _amount_cents integer, _currency text, _source text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; existing record;
BEGIN
  IF _transaction_id IS NULL OR _amount_cents IS NULL OR _amount_cents <= 0 THEN RETURN 'invalid'; END IF;
  IF upper(coalesce(_currency,'')) <> 'EUR' THEN RETURN 'currency_mismatch'; END IF;
  IF _provider NOT IN ('viva','mollie') OR _kind NOT IN ('payment','refund') OR _source NOT IN ('poll','webhook') THEN RETURN 'invalid'; END IF;
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
  DELETE FROM public.appointment_checkout_claims WHERE payment_id = _payment_id;
  RETURN 'recorded';
END $$;

CREATE OR REPLACE FUNCTION public.appointment_ledger_totals(_tenant_id uuid, _appointment_id uuid)
RETURNS TABLE(paid_cents bigint, refunded_cents bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(amount_cents) FILTER (WHERE kind = 'payment'),0)::bigint,
         coalesce(sum(amount_cents) FILTER (WHERE kind = 'refund'),0)::bigint
  FROM public.payment_ledger WHERE tenant_id = _tenant_id AND appointment_id = _appointment_id;
$$;

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
GRANT EXECUTE ON FUNCTION public.release_checkout_claim(text) TO service_role;-- Separate confidential platform commission from salon-readable payments. Rev 2 (tested, 51/51).
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

CREATE TABLE public.platform_owners (
  user_id uuid PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text
);
REVOKE ALL ON public.platform_owners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_owners TO service_role;
ALTER TABLE public.platform_owners ENABLE ROW LEVEL SECURITY;

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
REVOKE ALL ON FUNCTION public.guard_platform_payment_metadata() FROM PUBLIC, anon, authenticated;CREATE TABLE public.platform_isv_fees (
  scope_key text PRIMARY KEY,
  tenant_id uuid UNIQUE,
  online_bps integer NOT NULL DEFAULT 0 CHECK (online_bps BETWEEN 0 AND 2000),
  online_fixed_cents integer NOT NULL DEFAULT 35 CHECK (online_fixed_cents BETWEEN 0 AND 10000),
  terminal_bps integer NOT NULL DEFAULT 150 CHECK (terminal_bps BETWEEN 0 AND 2000),
  terminal_fixed_cents integer NOT NULL DEFAULT 0 CHECK (terminal_fixed_cents BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK ((scope_key = 'default' AND tenant_id IS NULL) OR (tenant_id IS NOT NULL AND scope_key = tenant_id::text))
);
GRANT ALL ON public.platform_isv_fees TO service_role;
ALTER TABLE public.platform_isv_fees ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.isv_fee_snapshots (
  payment_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('online','terminal')),
  environment text NOT NULL CHECK (environment IN ('demo','live')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0 AND fee_cents < amount_cents),
  bps integer NOT NULL,
  fixed_cents integer NOT NULL,
  refunded_amount_cents integer NOT NULL DEFAULT 0 CHECK (refunded_amount_cents >= 0),
  refunded_fee_cents integer NOT NULL DEFAULT 0 CHECK (refunded_fee_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_amount_cents <= amount_cents AND refunded_fee_cents <= fee_cents)
);
GRANT ALL ON public.isv_fee_snapshots TO service_role;
ALTER TABLE public.isv_fee_snapshots ENABLE ROW LEVEL SECURITY;

-- Service-role resolver: tenant override, else default row, else built-in defaults.
CREATE OR REPLACE FUNCTION public.isv_fee_config(_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('source','tenant','online_bps',online_bps,'online_fixed_cents',online_fixed_cents,'terminal_bps',terminal_bps,'terminal_fixed_cents',terminal_fixed_cents) FROM public.platform_isv_fees WHERE tenant_id = _tenant),
    (SELECT jsonb_build_object('source','default','online_bps',online_bps,'online_fixed_cents',online_fixed_cents,'terminal_bps',terminal_bps,'terminal_fixed_cents',terminal_fixed_cents) FROM public.platform_isv_fees WHERE scope_key = 'default'),
    jsonb_build_object('source','builtin','online_bps',0,'online_fixed_cents',35,'terminal_bps',150,'terminal_fixed_cents',0));
$$;
REVOKE ALL ON FUNCTION public.isv_fee_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.isv_fee_config(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_isv_fees_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE uid uuid := public.platform_require_owner_aal2(); res jsonb;
BEGIN
  INSERT INTO public.audit_logs (user_id, actor_user_id, action, target_type, target_id, details, is_demo)
  VALUES (uid, uid, 'platform_isv_fees_list', 'platform', 'all', '{}'::jsonb, false);
  SELECT jsonb_build_object(
    'default', public.isv_fee_config(NULL),
    'salons', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'tenant_id', st.user_id,
      'salon_name', coalesce(nullif(st.salon_name,''), 'Naamloze salon'),
      'is_demo', coalesce(st.is_demo,false),
      'fee', public.isv_fee_config(st.user_id)) ORDER BY coalesce(st.is_demo,false), st.salon_name)
      FROM public.settings st), '[]'::jsonb)) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_isv_fee(_tenant uuid, _online_bps integer, _online_fixed_cents integer, _terminal_bps integer, _terminal_fixed_cents integer, _reset boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE uid uuid := public.platform_require_owner_aal2(); old jsonb; k text;
BEGIN
  IF _tenant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.settings WHERE user_id = _tenant) THEN
    RAISE EXCEPTION 'unknown_tenant' USING ERRCODE = '22023'; END IF;
  k := coalesce(_tenant::text, 'default');
  old := public.isv_fee_config(_tenant);
  IF _reset THEN
    IF _tenant IS NULL THEN RAISE EXCEPTION 'cannot_reset_default' USING ERRCODE = '22023'; END IF;
    DELETE FROM public.platform_isv_fees WHERE scope_key = k;
  ELSE
    IF _online_bps NOT BETWEEN 0 AND 2000 OR _terminal_bps NOT BETWEEN 0 AND 2000
       OR _online_fixed_cents NOT BETWEEN 0 AND 10000 OR _terminal_fixed_cents NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION 'fee_out_of_bounds' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.platform_isv_fees (scope_key, tenant_id, online_bps, online_fixed_cents, terminal_bps, terminal_fixed_cents, updated_at, updated_by)
    VALUES (k, _tenant, _online_bps, _online_fixed_cents, _terminal_bps, _terminal_fixed_cents, now(), uid)
    ON CONFLICT (scope_key) DO UPDATE SET online_bps = EXCLUDED.online_bps, online_fixed_cents = EXCLUDED.online_fixed_cents,
      terminal_bps = EXCLUDED.terminal_bps, terminal_fixed_cents = EXCLUDED.terminal_fixed_cents, updated_at = now(), updated_by = uid;
  END IF;
  INSERT INTO public.audit_logs (user_id, actor_user_id, action, target_type, target_id, details, is_demo)
  VALUES (uid, uid, 'platform_set_isv_fee', 'isv_fee', k, jsonb_build_object('old', old, 'new', public.isv_fee_config(_tenant), 'reset', _reset), false);
  RETURN public.isv_fee_config(_tenant);
END $$;

REVOKE ALL ON FUNCTION public.platform_isv_fees_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_set_isv_fee(uuid, integer, integer, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_isv_fees_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_isv_fee(uuid, integer, integer, integer, integer, boolean) TO authenticated;CREATE TABLE public.isv_payment_orders (
 payment_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, request_key text NOT NULL, merchant_id text NOT NULL,
 state text NOT NULL DEFAULT 'dispatching' CHECK(state IN ('dispatching','ready','held','paid','failed')),
 order_code text UNIQUE, checkout_url text, transaction_id text UNIQUE, failure_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,request_key)
);
GRANT ALL ON public.isv_payment_orders TO service_role;
ALTER TABLE public.isv_payment_orders ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.isv_payment_refunds (
 transaction_id text PRIMARY KEY, payment_id uuid NOT NULL REFERENCES public.isv_payment_orders(payment_id),
 amount_cents integer NOT NULL CHECK(amount_cents>0), fee_cents integer NOT NULL CHECK(fee_cents>=0), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.isv_payment_refunds TO service_role;
ALTER TABLE public.isv_payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.isv_payment_reserve(_payment jsonb,_snapshot jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pid uuid:=(_payment->>'id')::uuid; tid uuid:=(_payment->>'user_id')::uuid; m jsonb:=_payment->'metadata'; cfg jsonb; amt integer; fee integer;
BEGIN
 amt:=(_snapshot->>'amount_cents')::integer;
 IF _snapshot->>'environment'<>'live' OR (_snapshot->>'tenant_id')::uuid<>tid OR (_snapshot->>'payment_id')::uuid<>pid OR amt<=0 OR round((_payment->>'amount')::numeric*100)<>amt THEN RETURN 'error'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.settings WHERE user_id=tid AND coalesce(is_demo,false)=false AND coalesce(demo_mode,false)=false) THEN RETURN 'error'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.glowpay_connected_merchants WHERE user_id=tid AND is_demo=false AND viva_merchant_id=m->>'viva_merchant_id') THEN RETURN 'error'; END IF;
 IF m->>'appointment_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments WHERE id=(m->>'appointment_id')::uuid AND user_id=tid) THEN RETURN 'error'; END IF;
 IF m->>'customer_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=(m->>'customer_id')::uuid AND user_id=tid) THEN RETURN 'error'; END IF;
 cfg:=public.isv_fee_config(tid);
 fee:=least(amt-1,floor((amt::bigint*(cfg->>'online_bps')::int+5000)/10000.0)::int+(cfg->>'online_fixed_cents')::int);
 IF fee<>(_snapshot->>'fee_cents')::int THEN RETURN 'error'; END IF;
 INSERT INTO public.isv_payment_orders(payment_id,tenant_id,request_key,merchant_id) VALUES(pid,tid,m->>'idempotency_key',m->>'viva_merchant_id') ON CONFLICT(tenant_id,request_key) DO NOTHING;
 IF NOT FOUND THEN RETURN 'duplicate'; END IF;
 INSERT INTO public.payments(id,user_id,appointment_id,customer_id,amount,currency,payment_type,status,method,is_demo,provider,viva_merchant_id,viva_source_code,metadata)
 VALUES(pid,tid,(m->>'appointment_id')::uuid,(m->>'customer_id')::uuid,amt/100.0,'EUR',coalesce(m->>'payment_type','deposit'),'pending','viva',false,'viva',m->>'viva_merchant_id','Default',m);
 INSERT INTO public.isv_fee_snapshots(payment_id,tenant_id,channel,environment,amount_cents,fee_cents,bps,fixed_cents)
 VALUES(pid,tid,'online','live',amt,fee,(cfg->>'online_bps')::int,(cfg->>'online_fixed_cents')::int);
 RETURN 'ok';
END $$;
CREATE OR REPLACE FUNCTION public.isv_payment_attach(_payment_id uuid,_order_code text,_checkout_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF _order_code !~ '^[0-9]{10,20}$' OR _checkout_url<>'https://www.vivapayments.com/web/checkout?ref='||_order_code THEN RETURN false; END IF;
 UPDATE public.isv_payment_orders SET order_code=_order_code,checkout_url=_checkout_url,state='ready' WHERE payment_id=_payment_id AND state IN ('dispatching','held') AND order_code IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.payments SET checkout_reference=_order_code,mollie_payment_id=_order_code,metadata=metadata||jsonb_build_object('viva_order_code',_order_code,'checkout_url',_checkout_url) WHERE id=_payment_id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.isv_payment_record(_payment_id uuid,_transaction_id text,_kind text,_amount_cents integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o record; s record; result text; cumulative integer; returned_fee integer;
BEGIN
 SELECT * INTO o FROM public.isv_payment_orders WHERE payment_id=_payment_id FOR UPDATE;
 IF NOT FOUND OR o.order_code IS NULL THEN RETURN 'error'; END IF;
 SELECT * INTO s FROM public.isv_fee_snapshots WHERE payment_id=_payment_id FOR UPDATE;
 IF NOT FOUND OR s.environment<>'live' THEN RETURN 'error'; END IF;
 IF _kind='refund' AND EXISTS(SELECT 1 FROM public.isv_payment_refunds WHERE transaction_id=_transaction_id AND payment_id=_payment_id AND amount_cents=_amount_cents) THEN RETURN 'duplicate'; END IF;
 IF _kind='refund' AND (o.state<>'paid' OR s.refunded_amount_cents+_amount_cents>s.amount_cents) THEN RETURN 'error'; END IF;
 result:=public.record_provider_payment(o.tenant_id,_payment_id,'viva',_transaction_id,_kind,_amount_cents,'EUR','webhook');
 IF result NOT IN ('recorded','duplicate') THEN RETURN 'error'; END IF;
 IF _kind='payment' THEN
 UPDATE public.isv_payment_orders SET state='paid',transaction_id=_transaction_id WHERE payment_id=_payment_id;
 UPDATE public.payments SET status='paid',paid_at=coalesce(paid_at,now()),metadata=metadata||jsonb_build_object('viva_transaction_id',_transaction_id,'verified_via','viva_isv_live_api') WHERE id=_payment_id;
 IF result='recorded' THEN
 INSERT INTO public.platform_commission_entries(tenant_id,payment_id,provider,provider_transaction_id,kind,amount_cents,currency)
 VALUES(o.tenant_id,_payment_id,'viva',_transaction_id,'payment',s.fee_cents,'EUR');
 END IF;
 ELSE
 cumulative:=s.refunded_amount_cents+_amount_cents;
 returned_fee:=least(s.fee_cents-s.refunded_fee_cents,greatest(0,(CASE WHEN cumulative=s.amount_cents THEN s.fee_cents ELSE floor((s.fee_cents::bigint*cumulative*2+s.amount_cents)/(2.0*s.amount_cents))::int END)-s.refunded_fee_cents));
 INSERT INTO public.isv_payment_refunds(transaction_id,payment_id,amount_cents,fee_cents) VALUES(_transaction_id,_payment_id,_amount_cents,returned_fee);
 UPDATE public.isv_fee_snapshots SET refunded_amount_cents=cumulative,refunded_fee_cents=refunded_fee_cents+returned_fee WHERE payment_id=_payment_id;
 UPDATE public.payments SET refunded_amount=cumulative/100.0,refunded_at=now() WHERE id=_payment_id;
 END IF;
 RETURN CASE WHEN result='duplicate' THEN 'duplicate' ELSE 'ok' END;
END $$;
REVOKE ALL ON FUNCTION public.isv_payment_reserve(jsonb,jsonb),public.isv_payment_attach(uuid,text,text),public.isv_payment_record(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.isv_payment_reserve(jsonb,jsonb),public.isv_payment_attach(uuid,text,text),public.isv_payment_record(uuid,text,text,integer) TO service_role;CREATE OR REPLACE FUNCTION public.isv_payment_record(_payment_id uuid,_transaction_id text,_kind text,_amount_cents integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o record; s record; result text; cumulative integer; returned_fee integer;
BEGIN
 SELECT * INTO o FROM public.isv_payment_orders WHERE payment_id=_payment_id FOR UPDATE;
 IF NOT FOUND OR o.order_code IS NULL THEN RETURN 'error'; END IF;
 SELECT * INTO s FROM public.isv_fee_snapshots WHERE payment_id=_payment_id FOR UPDATE;
 IF NOT FOUND OR s.environment<>'live' THEN RETURN 'error'; END IF;
 IF _kind='refund' AND EXISTS(SELECT 1 FROM public.isv_payment_refunds WHERE transaction_id=_transaction_id AND payment_id=_payment_id AND amount_cents=_amount_cents) THEN RETURN 'duplicate'; END IF;
 IF _kind='refund' AND (o.state<>'paid' OR s.refunded_amount_cents+_amount_cents>s.amount_cents) THEN RETURN 'error'; END IF;
 result:=public.record_provider_payment(o.tenant_id,_payment_id,'viva',_transaction_id,_kind,_amount_cents,'EUR','webhook');
 IF result NOT IN ('recorded','duplicate') THEN RETURN 'error'; END IF;
 IF _kind='payment' THEN
 UPDATE public.isv_payment_orders SET state='paid',transaction_id=_transaction_id WHERE payment_id=_payment_id;
 UPDATE public.payments SET status='paid',paid_at=coalesce(paid_at,now()),metadata=metadata||jsonb_build_object('viva_transaction_id',_transaction_id,'verified_via','viva_isv_live_api') WHERE id=_payment_id;
 PERFORM public.record_platform_commission(_payment_id,'confirmed',s.fee_cents,'viva_webhook',_transaction_id);
 ELSE
 cumulative:=s.refunded_amount_cents+_amount_cents;
 returned_fee:=least(s.fee_cents-s.refunded_fee_cents,greatest(0,(CASE WHEN cumulative=s.amount_cents THEN s.fee_cents ELSE floor((s.fee_cents::bigint*cumulative*2+s.amount_cents)/(2.0*s.amount_cents))::int END)-s.refunded_fee_cents));
 INSERT INTO public.isv_payment_refunds(transaction_id,payment_id,amount_cents,fee_cents) VALUES(_transaction_id,_payment_id,_amount_cents,returned_fee);
 UPDATE public.isv_fee_snapshots SET refunded_amount_cents=cumulative,refunded_fee_cents=refunded_fee_cents+returned_fee WHERE payment_id=_payment_id;
 UPDATE public.payments SET refunded_amount=cumulative/100.0,refunded_at=now() WHERE id=_payment_id;
 PERFORM public.record_platform_commission(_payment_id,'reversed',returned_fee,'viva_webhook',_transaction_id);
 END IF;
 RETURN CASE WHEN result='duplicate' THEN 'duplicate' ELSE 'ok' END;
END $$;
REVOKE ALL ON FUNCTION public.isv_payment_record(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.isv_payment_record(uuid,text,text,integer) TO service_role;
INSERT INTO settings VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false,false,'Fictional');
INSERT INTO glowpay_connected_merchants VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false,'11111111-2222-3333-4444-555555555555');
CREATE FUNCTION test_reserve(pid uuid,key text) RETURNS text LANGUAGE sql AS $$
 SELECT isv_payment_reserve(jsonb_build_object('id',pid,'user_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','amount',25,'metadata',jsonb_build_object('route','viva_isv_live','idempotency_key',key,'viva_merchant_id','11111111-2222-3333-4444-555555555555')),
 jsonb_build_object('payment_id',pid,'tenant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','environment','live','amount_cents',2500,'fee_cents',35)); $$;
CREATE FUNCTION assert_test(name text,got text,want text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '%: got %, expected %',name,got,want; END IF; RAISE NOTICE 'PASS: %',name; END $$;
