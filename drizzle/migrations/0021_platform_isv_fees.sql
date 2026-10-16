CREATE TABLE public.platform_isv_fees (
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
GRANT EXECUTE ON FUNCTION public.platform_set_isv_fee(uuid, integer, integer, integer, integer, boolean) TO authenticated;