CREATE TABLE public.historical_dossier_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('appointment','treatment_note')),
  occurred_on date NOT NULL,
  occurred_time time,
  service_name text,
  employee_name text,
  price numeric,
  status text,
  note text,
  source text NOT NULL DEFAULT 'salonized',
  source_hash text NOT NULL,
  import_batch_id uuid,
  imported_by uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, is_demo, source_hash)
);
CREATE INDEX historical_dossier_entries_customer_idx ON public.historical_dossier_entries(customer_id, occurred_on DESC);

GRANT SELECT ON public.historical_dossier_entries TO authenticated;
GRANT ALL ON public.historical_dossier_entries TO service_role;
ALTER TABLE public.historical_dossier_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff view historical entries" ON public.historical_dossier_entries
FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());

CREATE OR REPLACE FUNCTION public.import_historical_entries(_batch_id uuid, _entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _demo boolean := public.current_tenant_is_demo();
  _e jsonb; _inserted int := 0; _skipped int := 0; _rejected int := 0; _n int;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::app_role[]) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT _demo THEN RAISE EXCEPTION 'historical_import_disabled_in_production'; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.rollback_historical_import(_batch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::app_role[]) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM historical_dossier_entries WHERE import_batch_id = _batch_id AND user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo();
  GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.import_historical_entries(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rollback_historical_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_historical_entries(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_historical_import(uuid) TO authenticated;