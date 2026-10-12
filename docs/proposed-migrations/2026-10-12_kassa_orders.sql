-- PROPOSED (not applied). Veilige Kassa: serverbestellingen, live-poort, bescherming KYC/betaalstatus.
-- Vereist aparte GO. Uitvoeren als EEN transactie. Alle schakelaars standaard UIT.
-- Afhankelijk van 2026-10-11_appointment_checkout_ledger.sql (payment_ledger, record_provider_payment).
BEGIN;

-- 0. Schakelaars (alleen platformbeheer; app-gebruikers lezen alleen eigen rij).
ALTER TABLE public.tenant_feature_flags
  ADD COLUMN IF NOT EXISTS live_payments_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kassa_orders_enabled boolean NOT NULL DEFAULT false;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenant_feature_flags FROM PUBLIC, anon, authenticated, sandbox_exec;

-- 1. KYC / merchantbevoegdheden: alleen de server (service_role) mag ze zetten.
CREATE OR REPLACE FUNCTION public.protect_merchant_capabilities() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.kyc_status := 'pending'; NEW.onboarding_status := 'pending'; NEW.setup_complete := false;
    NEW.terminals_enabled := false; NEW.online_payments_enabled := false; NEW.payouts_enabled := false;
    NEW.viva_merchant_id := NULL; NEW.viva_account_id := NULL; NEW.viva_source_code := NULL; NEW.reseller_source_code := NULL;
    RETURN NEW;
  END IF;
  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status OR NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status
     OR NEW.setup_complete IS DISTINCT FROM OLD.setup_complete OR NEW.terminals_enabled IS DISTINCT FROM OLD.terminals_enabled
     OR NEW.online_payments_enabled IS DISTINCT FROM OLD.online_payments_enabled OR NEW.payouts_enabled IS DISTINCT FROM OLD.payouts_enabled
     OR NEW.viva_merchant_id IS DISTINCT FROM OLD.viva_merchant_id OR NEW.viva_account_id IS DISTINCT FROM OLD.viva_account_id
     OR NEW.viva_source_code IS DISTINCT FROM OLD.viva_source_code OR NEW.reseller_source_code IS DISTINCT FROM OLD.reseller_source_code
     OR NEW.is_demo IS DISTINCT FROM OLD.is_demo OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'merchant_capabilities_protected' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_merchant_capabilities ON public.glowpay_connected_merchants;
CREATE TRIGGER protect_merchant_capabilities BEFORE INSERT OR UPDATE ON public.glowpay_connected_merchants
  FOR EACH ROW EXECUTE FUNCTION public.protect_merchant_capabilities();

-- 2. Providerbetalingen (Viva/Mollie) en Kassa-betalingen: client mag status/bedrag/bewijs niet wijzigen.
--    Handmatige betalingen (geen provider) houden hun bestaande gedrag ("markeer als betaald").
CREATE OR REPLACE FUNCTION public.protect_provider_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE prov boolean;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN RETURN NEW; END IF;
  prov := coalesce(NEW.provider,'') IN ('viva','mollie') OR coalesce(NEW.metadata,'{}'::jsonb) ? 'kassa_order_id'
       OR (TG_OP = 'UPDATE' AND (coalesce(OLD.provider,'') IN ('viva','mollie') OR coalesce(OLD.metadata,'{}'::jsonb) ? 'kassa_order_id'));
  IF NOT prov THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'provider_payment_server_only' USING ERRCODE = '42501'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.is_demo IS DISTINCT FROM OLD.is_demo OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.metadata IS DISTINCT FROM OLD.metadata OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount
     OR NEW.mollie_payment_id IS DISTINCT FROM OLD.mollie_payment_id OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id THEN
    RAISE EXCEPTION 'provider_payment_protected' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_provider_payment ON public.payments;
CREATE TRIGGER protect_provider_payment BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_provider_payment();

-- 3. Bestellingen.
CREATE TABLE public.kassa_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  is_demo boolean NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  customer_id uuid,
  total_cents integer NOT NULL CHECK (total_cents > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','payment_open','payment_failed','settled','cancelled')),
  attempt integer NOT NULL DEFAULT 0,
  payment_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (tenant_id, request_id)
);
CREATE UNIQUE INDEX kassa_orders_payment_uq ON public.kassa_orders (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX kassa_orders_open_idx ON public.kassa_orders (tenant_id, is_demo, status);

CREATE TABLE public.kassa_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.kassa_orders(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('service','product')),
  item_id uuid NOT NULL,
  name text NOT NULL,
  unit_cents integer NOT NULL CHECK (unit_cents >= 0),
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 99),
  stock_shortfall integer NOT NULL DEFAULT 0
);

-- Elke betaalpoging: hoogstens EEN open poging per bestelling (unieke index op (order_id) WHERE open).
CREATE TABLE public.kassa_payment_attempts (
  order_id uuid NOT NULL REFERENCES public.kassa_orders(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payment_id uuid UNIQUE,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','failed','paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, attempt)
);
CREATE UNIQUE INDEX kassa_one_open_attempt ON public.kassa_payment_attempts (order_id) WHERE state = 'open';

REVOKE ALL ON public.kassa_orders, public.kassa_order_lines, public.kassa_payment_attempts FROM PUBLIC, anon, authenticated, service_role, sandbox_exec;
GRANT SELECT ON public.kassa_orders, public.kassa_order_lines, public.kassa_payment_attempts TO service_role;
ALTER TABLE public.kassa_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kassa_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kassa_payment_attempts ENABLE ROW LEVEL SECURITY;

-- 4. Actor -> salon + kassarol. Eigenaar = eigen salon; anders precies EEN actieve koppeling.
CREATE OR REPLACE FUNCTION public.kassa_actor_tenant(_actor uuid)
RETURNS TABLE(tenant_id uuid, role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF _actor IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _actor AND ur.role::text = 'eigenaar') THEN
    tenant_id := _actor; role := 'eigenaar'; RETURN NEXT; RETURN;
  END IF;
  SELECT count(DISTINCT ua.owner_user_id) INTO n FROM public.user_access ua WHERE ua.member_user_id = _actor AND ua.status = 'active';
  IF n <> 1 THEN RETURN; END IF;
  RETURN QUERY SELECT ua.owner_user_id, ua.role::text FROM public.user_access ua
    WHERE ua.member_user_id = _actor AND ua.status = 'active'
      AND ua.role::text IN ('admin','manager','medewerker','receptie') LIMIT 1;
END $$;

-- 5. Live-poort: ALLE voorwaarden, anders false. Demo-salon kan nooit live.
CREATE OR REPLACE FUNCTION public.kassa_live_allowed(_tenant uuid, _method text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT f.live_payments_enabled AND f.kassa_orders_enabled FROM public.tenant_feature_flags f WHERE f.tenant_id = _tenant), false)
    AND NOT coalesce((SELECT s.is_demo OR s.demo_mode FROM public.settings s WHERE s.user_id = _tenant ORDER BY s.created_at DESC LIMIT 1), true)
    AND EXISTS (SELECT 1 FROM public.glowpay_connected_merchants m WHERE m.user_id = _tenant AND m.is_demo = false
      AND coalesce(m.viva_merchant_id,'') <> '' AND btrim(coalesce(m.viva_source_code,'')) <> ''
      AND lower(coalesce(m.onboarding_status,'')) IN ('connected','active')
      AND lower(coalesce(m.kyc_status,'')) IN ('verified','approved','completed','active')
      AND m.setup_complete = true
      AND CASE _method WHEN 'terminal' THEN m.terminals_enabled = true WHEN 'link' THEN m.online_payments_enabled = true ELSE false END);
$$;

-- 6. Status voor de UI (geen techniek): per methode 'live' of 'demo'.
CREATE OR REPLACE FUNCTION public.kassa_payment_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  SELECT a.tenant_id INTO t FROM public.kassa_actor_tenant(auth.uid()) a;
  IF t IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  RETURN jsonb_build_object('ok', true,
    'enabled', coalesce((SELECT kassa_orders_enabled FROM public.tenant_feature_flags WHERE tenant_id = t), false),
    'terminal', CASE WHEN public.kassa_live_allowed(t,'terminal') THEN 'live' ELSE 'demo' END);
END $$;

-- 7. Bestelling maken. Prijzen, namen en salon uitsluitend uit de database. Demo alleen als bewust gekozen.
CREATE OR REPLACE FUNCTION public.kassa_create_order(_request_id uuid, _customer_id uuid, _lines jsonb, _demo boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; r text; l jsonb; it record; tot bigint := 0; oid uuid; h text; ex record; n integer;
BEGIN
  SELECT a.tenant_id, a.role INTO t, r FROM public.kassa_actor_tenant(auth.uid()) a;
  IF t IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  IF NOT coalesce((SELECT kassa_orders_enabled FROM public.tenant_feature_flags WHERE tenant_id = t), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled'); END IF;
  IF _request_id IS NULL OR _demo IS NULL OR jsonb_typeof(_lines) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  n := jsonb_array_length(_lines);
  IF n < 1 OR n > 50 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF NOT _demo AND NOT public.kassa_live_allowed(t, 'terminal') THEN RETURN jsonb_build_object('ok', false, 'reason', 'live_not_allowed'); END IF;
  h := md5(coalesce(_customer_id::text,'') || '|' || _demo::text || '|' || _lines::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(t::text || _request_id::text, 0));
  SELECT id, request_hash, total_cents, status, is_demo INTO ex FROM public.kassa_orders WHERE tenant_id = t AND request_id = _request_id;
  IF FOUND THEN
    IF ex.request_hash <> h THEN RETURN jsonb_build_object('ok', false, 'reason', 'conflict'); END IF;
    RETURN jsonb_build_object('ok', true, 'order_id', ex.id, 'total_cents', ex.total_cents, 'status', ex.status, 'is_demo', ex.is_demo, 'duplicate', true);
  END IF;
  IF _customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer_id AND c.user_id = t AND c.is_demo = _demo) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'customer_not_found'); END IF;
  INSERT INTO public.kassa_orders (tenant_id, is_demo, request_id, request_hash, customer_id, total_cents, created_by)
    VALUES (t, _demo, _request_id, h, _customer_id, 1, auth.uid()) RETURNING id INTO oid;
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    IF (l->>'type') NOT IN ('service','product') OR (l->>'qty') !~ '^[0-9]{1,2}$' OR (l->>'qty')::int < 1
       OR (l->>'item_id') !~* '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'kassa_invalid_line'; END IF;
    IF l->>'type' = 'product' THEN
      SELECT p.name, round(p.price*100)::int AS c INTO it FROM public.products p
        WHERE p.id = (l->>'item_id')::uuid AND p.user_id = t AND p.is_demo = _demo AND p.is_active;
    ELSE
      SELECT s.name, round(s.price*100)::int AS c INTO it FROM public.services s
        WHERE s.id = (l->>'item_id')::uuid AND s.user_id = t AND s.is_demo = _demo AND s.is_active;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'kassa_item_not_found'; END IF;
    INSERT INTO public.kassa_order_lines (order_id, item_type, item_id, name, unit_cents, qty)
      VALUES (oid, l->>'type', (l->>'item_id')::uuid, it.name, it.c, (l->>'qty')::int);
    tot := tot + it.c::bigint * (l->>'qty')::int;
  END LOOP;
  IF tot < 30 OR tot > 1000000 THEN RAISE EXCEPTION 'kassa_invalid_total'; END IF;
  UPDATE public.kassa_orders SET total_cents = tot WHERE id = oid;
  RETURN jsonb_build_object('ok', true, 'order_id', oid, 'total_cents', tot, 'status', 'draft', 'is_demo', _demo, 'duplicate', false);
EXCEPTION WHEN raise_exception THEN
  RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN SQLERRM = 'kassa_item_not_found' THEN 'item_not_found'
    WHEN SQLERRM = 'kassa_invalid_total' THEN 'invalid_total' ELSE 'invalid' END);
END $$;

-- 8. Open bestellingen van eigen salon + eigen omgeving (hervatten op ander apparaat).
CREATE OR REPLACE FUNCTION public.kassa_open_orders(_demo boolean)
RETURNS TABLE(order_id uuid, status text, total_cents integer, customer_id uuid, attempt integer, payment_id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.status, o.total_cents, o.customer_id, o.attempt, o.payment_id, o.created_at FROM public.kassa_orders o
  WHERE o.tenant_id = (SELECT a.tenant_id FROM public.kassa_actor_tenant(auth.uid()) a) AND o.is_demo = _demo
    AND o.status IN ('draft','payment_open','payment_failed') ORDER BY o.created_at DESC LIMIT 50;
$$;

-- 9. Betaalpoging (server). Vergrendelt de bestelling; open poging = dezelfde sleutel teruggeven.
CREATE OR REPLACE FUNCTION public.kassa_begin_attempt(_actor uuid, _order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; o record; a record; k text;
BEGIN
  SELECT x.tenant_id INTO t FROM public.kassa_actor_tenant(_actor) x;
  IF t IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  SELECT * INTO o FROM public.kassa_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR o.tenant_id <> t THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT o.is_demo AND NOT public.kassa_live_allowed(t, 'terminal') THEN RETURN jsonb_build_object('ok', false, 'reason', 'live_not_allowed'); END IF;
  IF o.status = 'settled' OR o.status = 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'reason', o.status); END IF;
  SELECT * INTO a FROM public.kassa_payment_attempts WHERE order_id = o.id AND state = 'open';
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'resumed', true, 'idempotency_key', a.idempotency_key, 'payment_id', a.payment_id,
      'total_cents', o.total_cents, 'is_demo', o.is_demo, 'tenant_id', t, 'customer_id', o.customer_id);
  END IF;
  k := 'kassa:' || o.id || ':' || CASE WHEN o.is_demo THEN 'demo' ELSE 'live' END || ':' || (o.attempt + 1);
  INSERT INTO public.kassa_payment_attempts (order_id, attempt, idempotency_key) VALUES (o.id, o.attempt + 1, k);
  UPDATE public.kassa_orders SET attempt = attempt + 1, status = 'payment_open', payment_id = NULL, updated_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('ok', true, 'resumed', false, 'idempotency_key', k, 'payment_id', NULL,
    'total_cents', o.total_cents, 'is_demo', o.is_demo, 'tenant_id', t, 'customer_id', o.customer_id);
END $$;

CREATE OR REPLACE FUNCTION public.kassa_attach_payment(_order_id uuid, _key text, _payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; p record;
BEGIN
  SELECT * INTO o FROM public.kassa_orders WHERE id = _order_id FOR UPDATE;
  SELECT id, user_id, is_demo, amount, metadata INTO p FROM public.payments WHERE id = _payment_id;
  IF o.id IS NULL OR p.id IS NULL OR p.user_id <> o.tenant_id OR p.is_demo <> o.is_demo
     OR round(p.amount*100)::int <> o.total_cents OR (p.metadata->>'kassa_order_id') IS DISTINCT FROM o.id::text THEN RETURN false; END IF;
  UPDATE public.kassa_payment_attempts SET payment_id = _payment_id
    WHERE order_id = o.id AND idempotency_key = _key AND state = 'open' AND (payment_id IS NULL OR payment_id = _payment_id);
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.kassa_orders SET payment_id = _payment_id, updated_at = now() WHERE id = o.id;
  RETURN true;
END $$;

-- 10. Provider meldt definitief mislukt: poging sluiten, voorraad/omzet onaangeroerd. Nooit na bewijs van betaling.
CREATE OR REPLACE FUNCTION public.kassa_attempt_failed(_payment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT ko.* INTO o FROM public.kassa_payment_attempts a JOIN public.kassa_orders ko ON ko.id = a.order_id
    WHERE a.payment_id = _payment_id FOR UPDATE OF ko;
  IF NOT FOUND THEN RETURN 'not_kassa'; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_ledger WHERE payment_id = _payment_id AND kind = 'payment') THEN RETURN 'has_evidence'; END IF;
  UPDATE public.kassa_payment_attempts SET state = 'failed' WHERE payment_id = _payment_id AND state = 'open';
  IF NOT FOUND THEN RETURN 'noop'; END IF;
  UPDATE public.kassa_orders SET status = 'payment_failed', updated_at = now() WHERE id = o.id AND status = 'payment_open' AND payment_id = _payment_id;
  RETURN 'failed';
END $$;

-- 11. Precies-een-keer verwerken. Vereist providerbewijs in payment_ledger (niet alleen payments.status).
CREATE OR REPLACE FUNCTION public.kassa_settle_order(_payment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; ev record; l record; have integer; short integer;
BEGIN
  SELECT ko.* INTO o FROM public.kassa_payment_attempts a JOIN public.kassa_orders ko ON ko.id = a.order_id
    WHERE a.payment_id = _payment_id FOR UPDATE OF ko;
  IF NOT FOUND THEN RETURN 'not_kassa'; END IF;
  IF o.status = 'settled' THEN RETURN 'duplicate'; END IF;
  SELECT sum(amount_cents) AS c, bool_and(is_demo = o.is_demo) AS mode_ok, bool_and(tenant_id = o.tenant_id) AS tenant_ok
    INTO ev FROM public.payment_ledger WHERE payment_id = _payment_id AND kind = 'payment';
  IF ev.c IS NULL THEN RETURN 'no_evidence'; END IF;
  IF NOT ev.mode_ok OR NOT ev.tenant_ok OR ev.c <> o.total_cents THEN RETURN 'evidence_mismatch'; END IF;
  IF NOT o.is_demo THEN
    FOR l IN SELECT * FROM public.kassa_order_lines WHERE order_id = o.id ORDER BY item_id LOOP
      IF l.item_type = 'product' THEN
        SELECT stock INTO have FROM public.products WHERE id = l.item_id AND user_id = o.tenant_id AND is_demo = false FOR UPDATE;
        have := greatest(coalesce(have, 0), 0);
        short := greatest(l.qty - have, 0);
        UPDATE public.products SET stock = greatest(coalesce(stock,0) - l.qty, 0), updated_at = now()
          WHERE id = l.item_id AND user_id = o.tenant_id AND is_demo = false;
        IF short > 0 THEN UPDATE public.kassa_order_lines SET stock_shortfall = short WHERE id = l.id; END IF;
      END IF;
      INSERT INTO public.checkout_items (user_id, item_type, item_id, title, price, quantity, customer_id, is_demo)
        VALUES (o.tenant_id, l.item_type, l.item_id, l.name, l.unit_cents / 100.0, l.qty, o.customer_id, false);
    END LOOP;
    IF o.customer_id IS NOT NULL THEN
      UPDATE public.customers SET total_spent = coalesce(total_spent,0) + o.total_cents / 100.0, updated_at = now()
        WHERE id = o.customer_id AND user_id = o.tenant_id AND is_demo = false;
    END IF;
  END IF;
  UPDATE public.kassa_payment_attempts SET state = 'paid' WHERE payment_id = _payment_id;
  UPDATE public.kassa_orders SET status = 'settled', settled_at = now(), updated_at = now() WHERE id = o.id;
  RETURN CASE WHEN o.is_demo THEN 'settled_demo' ELSE 'settled' END;
END $$;

REVOKE ALL ON FUNCTION public.kassa_actor_tenant(uuid), public.kassa_live_allowed(uuid,text), public.kassa_payment_status(),
  public.kassa_create_order(uuid,uuid,jsonb,boolean), public.kassa_open_orders(boolean), public.kassa_begin_attempt(uuid,uuid),
  public.kassa_attach_payment(uuid,text,uuid), public.kassa_attempt_failed(uuid), public.kassa_settle_order(uuid),
  public.protect_merchant_capabilities(), public.protect_provider_payment() FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.kassa_payment_status(), public.kassa_create_order(uuid,uuid,jsonb,boolean), public.kassa_open_orders(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kassa_actor_tenant(uuid), public.kassa_live_allowed(uuid,text), public.kassa_begin_attempt(uuid,uuid),
  public.kassa_attach_payment(uuid,text,uuid), public.kassa_attempt_failed(uuid), public.kassa_settle_order(uuid) TO service_role;

COMMIT;
