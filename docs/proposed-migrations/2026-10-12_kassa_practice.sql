-- Kassa-oefenmodus: per salon (platform-only flag, default UIT). Echte producten/behandelingen/klanten alleen gelezen.
-- Oefenbestelling: aparte markering, status practice_paid, nooit payments/ledger/voorraad/omzet/kassaregels/afspraken.
ALTER TABLE public.tenant_feature_flags ADD COLUMN IF NOT EXISTS kassa_practice_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.kassa_orders ADD COLUMN IF NOT EXISTS is_practice boolean NOT NULL DEFAULT false;
ALTER TABLE public.kassa_orders DROP CONSTRAINT IF EXISTS kassa_orders_status_check;
ALTER TABLE public.kassa_orders ADD CONSTRAINT kassa_orders_status_check
  CHECK (status IN ('draft','payment_open','payment_failed','settled','cancelled','practice_paid'));
ALTER TABLE public.kassa_orders ADD CONSTRAINT kassa_orders_practice_check
  CHECK (NOT is_practice OR (is_demo AND status = 'practice_paid' AND payment_id IS NULL AND attempt = 0));

CREATE OR REPLACE FUNCTION public.kassa_payment_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  SELECT a.tenant_id INTO t FROM public.kassa_actor_tenant(auth.uid()) a;
  IF t IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  RETURN jsonb_build_object('ok', true,
    'enabled', coalesce((SELECT kassa_orders_enabled FROM public.tenant_feature_flags WHERE tenant_id = t), false),
    'practice', coalesce((SELECT kassa_practice_enabled FROM public.tenant_feature_flags WHERE tenant_id = t), false),
    'terminal', CASE WHEN public.kassa_live_allowed(t,'terminal') THEN 'live' ELSE 'demo' END);
END $$;

-- Oefenbetaling: server maakt en bevestigt in een stap. Zelfde request-ID = zelfde bestelling, nooit dubbel.
CREATE OR REPLACE FUNCTION public.kassa_practice_checkout(_request_id uuid, _customer_id uuid, _lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; m boolean; l jsonb; it record; tot bigint := 0; oid uuid; h text; ex record; n integer;
BEGIN
  SELECT a.tenant_id INTO t FROM public.kassa_actor_tenant(auth.uid()) a;
  IF t IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  IF NOT coalesce((SELECT kassa_practice_enabled FROM public.tenant_feature_flags WHERE tenant_id = t), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'practice_disabled'); END IF;
  IF _request_id IS NULL OR jsonb_typeof(_lines) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  n := jsonb_array_length(_lines);
  IF n < 1 OR n > 50 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  -- Items/klant uit de eigen omgeving van de salon (echte salon: echte gegevens, alleen gelezen).
  m := coalesce((SELECT s.is_demo OR s.demo_mode FROM public.settings s WHERE s.user_id = t ORDER BY s.created_at DESC LIMIT 1), false);
  h := md5('practice|' || coalesce(_customer_id::text,'') || '|' || _lines::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(t::text || _request_id::text, 0));
  SELECT id, request_hash, total_cents, status, is_practice INTO ex FROM public.kassa_orders WHERE tenant_id = t AND request_id = _request_id;
  IF FOUND THEN
    IF ex.request_hash <> h OR NOT ex.is_practice THEN RETURN jsonb_build_object('ok', false, 'reason', 'conflict'); END IF;
    RETURN jsonb_build_object('ok', true, 'order_id', ex.id, 'total_cents', ex.total_cents, 'status', ex.status, 'practice', true, 'duplicate', true);
  END IF;
  IF _customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer_id AND c.user_id = t AND c.is_demo = m) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'customer_not_found'); END IF;
  INSERT INTO public.kassa_orders (tenant_id, is_demo, is_practice, request_id, request_hash, customer_id, total_cents, status, created_by, settled_at)
    VALUES (t, true, true, _request_id, h, _customer_id, 1, 'practice_paid', auth.uid(), now()) RETURNING id INTO oid;
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    IF NOT coalesce((l->>'type') IN ('service','product') AND (l->>'qty') ~ '^[1-9][0-9]?$'
       AND (l->>'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) THEN RAISE EXCEPTION 'kassa_invalid_line'; END IF;
    IF l->>'type' = 'product' THEN
      SELECT p.name, round(p.price*100)::int AS c INTO it FROM public.products p
        WHERE p.id = (l->>'item_id')::uuid AND p.user_id = t AND p.is_demo = m AND p.is_active;
    ELSE
      SELECT s.name, round(s.price*100)::int AS c INTO it FROM public.services s
        WHERE s.id = (l->>'item_id')::uuid AND s.user_id = t AND s.is_demo = m AND s.is_active;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'kassa_item_not_found'; END IF;
    INSERT INTO public.kassa_order_lines (order_id, item_type, item_id, name, unit_cents, qty)
      VALUES (oid, l->>'type', (l->>'item_id')::uuid, it.name, it.c, (l->>'qty')::int);
    tot := tot + it.c::bigint * (l->>'qty')::int;
  END LOOP;
  IF tot < 30 OR tot > 1000000 THEN RAISE EXCEPTION 'kassa_invalid_total'; END IF;
  UPDATE public.kassa_orders SET total_cents = tot WHERE id = oid;
  RETURN jsonb_build_object('ok', true, 'order_id', oid, 'total_cents', tot, 'status', 'practice_paid', 'practice', true, 'duplicate', false);
EXCEPTION WHEN raise_exception THEN
  RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN SQLERRM = 'kassa_item_not_found' THEN 'item_not_found'
    WHEN SQLERRM = 'kassa_invalid_total' THEN 'invalid_total' ELSE 'invalid' END);
END $$;

-- Echte betaalpaden weigeren oefenbestellingen expliciet.
CREATE OR REPLACE FUNCTION public.kassa_begin_attempt(_actor uuid, _order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; o record; a record; k text;
BEGIN
  SELECT x.tenant_id INTO t FROM public.kassa_actor_tenant(_actor) x;
  IF t IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  SELECT * INTO o FROM public.kassa_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR o.tenant_id <> t THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF o.is_practice THEN RETURN jsonb_build_object('ok', false, 'reason', 'practice'); END IF;
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
  IF o.id IS NULL OR o.is_practice THEN RETURN false; END IF;
  SELECT id, user_id, is_demo, amount, metadata INTO p FROM public.payments WHERE id = _payment_id;
  IF p.id IS NULL OR p.user_id <> o.tenant_id OR p.is_demo <> o.is_demo
     OR round(p.amount*100)::int <> o.total_cents OR (p.metadata->>'kassa_order_id') IS DISTINCT FROM o.id::text THEN RETURN false; END IF;
  UPDATE public.kassa_payment_attempts SET payment_id = _payment_id
    WHERE order_id = o.id AND idempotency_key = _key AND state = 'open' AND (payment_id IS NULL OR payment_id = _payment_id);
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.kassa_orders SET payment_id = _payment_id, updated_at = now() WHERE id = o.id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.kassa_settle_order(_payment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; ev record; l record; have integer; short integer;
BEGIN
  SELECT ko.* INTO o FROM public.kassa_payment_attempts a JOIN public.kassa_orders ko ON ko.id = a.order_id
    WHERE a.payment_id = _payment_id FOR UPDATE OF ko;
  IF NOT FOUND THEN RETURN 'not_kassa'; END IF;
  IF o.is_practice THEN RETURN 'practice'; END IF;
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

-- Normale/demo-bestelling kan een oefen-request-ID niet overnemen (bestaande functie: hash verschilt -> conflict).
REVOKE ALL ON FUNCTION public.kassa_practice_checkout(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.kassa_practice_checkout(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.kassa_payment_status(), public.kassa_begin_attempt(uuid,uuid), public.kassa_attach_payment(uuid,text,uuid),
  public.kassa_settle_order(uuid) FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.kassa_payment_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kassa_begin_attempt(uuid,uuid), public.kassa_attach_payment(uuid,text,uuid), public.kassa_settle_order(uuid) TO service_role;
