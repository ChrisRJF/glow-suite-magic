CREATE TABLE public.tenant_feature_flags (
  tenant_id uuid PRIMARY KEY,
  history_csv_preview_enabled boolean NOT NULL DEFAULT false,
  history_csv_import_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenant_feature_flags TO authenticated;
GRANT ALL ON public.tenant_feature_flags TO service_role;
ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant reads own flags" ON public.tenant_feature_flags FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.history_import_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'demo', public.current_tenant_is_demo(),
    'preview', public.current_tenant_is_demo() OR COALESCE((SELECT f.history_csv_preview_enabled FROM tenant_feature_flags f WHERE f.tenant_id = public.current_tenant_id()), false),
    'import', public.current_tenant_is_demo() OR COALESCE((SELECT f.history_csv_import_enabled FROM tenant_feature_flags f WHERE f.tenant_id = public.current_tenant_id()), false)
  )
$$;
REVOKE EXECUTE ON FUNCTION public.history_import_access() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.history_import_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.import_historical_entries(_batch_id uuid, _entries jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _demo boolean := public.current_tenant_is_demo();
  _e jsonb; _inserted int := 0; _skipped int := 0; _rejected int := 0; _n int;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::app_role[]) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT _demo AND NOT COALESCE((SELECT f.history_csv_import_enabled FROM tenant_feature_flags f WHERE f.tenant_id = _tenant), false) THEN
    RAISE EXCEPTION 'historical_import_disabled_in_production';
  END IF;
  IF jsonb_array_length(_entries) > 5000 THEN RAISE EXCEPTION 'too_many_rows'; END IF;
  FOR _e IN SELECT * FROM jsonb_array_elements(_entries) LOOP
    IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = (_e->>'customer_id')::uuid AND c.user_id = _tenant AND c.is_demo = _demo)
       OR (_e->>'kind') NOT IN ('appointment','treatment_note')
       OR (_e->>'occurred_on') IS NULL OR coalesce(_e->>'source_hash','') = '' THEN
      _rejected := _rejected + 1; CONTINUE;
    END IF;
    INSERT INTO historical_dossier_entries(user_id, is_demo, customer_id, kind, occurred_on, occurred_time, service_name, employee_name, price, status, note, source, source_hash, import_batch_id, imported_by)
    VALUES (_tenant, _demo, (_e->>'customer_id')::uuid, _e->>'kind', (_e->>'occurred_on')::date, nullif(_e->>'occurred_time','')::time,
      left(_e->>'service_name',200), left(_e->>'employee_name',120), nullif(_e->>'price','')::numeric, left(_e->>'status',60), left(_e->>'note',10000),
      'salonized', _e->>'source_hash', _batch_id, auth.uid())
    ON CONFLICT (user_id, is_demo, source_hash) DO NOTHING;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n = 1 THEN _inserted := _inserted + 1; ELSE _skipped := _skipped + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', _inserted, 'skipped', _skipped, 'rejected', _rejected);
END $function$;

CREATE OR REPLACE FUNCTION public.rollback_historical_import(_batch_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _n int; _tenant uuid := public.current_tenant_id(); _demo boolean := public.current_tenant_is_demo();
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::app_role[]) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT _demo AND NOT COALESCE((SELECT f.history_csv_import_enabled FROM tenant_feature_flags f WHERE f.tenant_id = _tenant), false) THEN
    RAISE EXCEPTION 'historical_import_disabled_in_production';
  END IF;
  DELETE FROM historical_dossier_entries WHERE import_batch_id = _batch_id AND user_id = _tenant AND is_demo = _demo;
  GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n;
END $function$;