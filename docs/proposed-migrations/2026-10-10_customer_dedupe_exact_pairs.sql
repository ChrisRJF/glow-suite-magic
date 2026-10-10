-- PROPOSED, NOT APPLIED. Needs explicit written approval before running in production.
-- Replaces docs/proposed-migrations/2026-10-10_customer_merge.sql for bulk use (that file must NOT run).
-- Reversible marking of exact duplicate customer pairs. Nothing is deleted, no linked row is moved,
-- no consent value is changed. The duplicate keeps its own id and every original value; only
-- merged_into / merged_at / merge_batch_id are set, and a full row snapshot is kept for undo.
-- Only callable by service_role (platform operator), never by salon users.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS merged_into uuid NULL;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS merge_batch_id uuid NULL;
CREATE INDEX IF NOT EXISTS customers_merged_into_idx ON public.customers (merged_into) WHERE merged_into IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_merge_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'previewed', -- previewed | applied | undone
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz, undone_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.customer_merge_pairs (
  batch_id uuid NOT NULL REFERENCES public.customer_merge_batches(id),
  tenant_id uuid NOT NULL,
  survivor_id uuid NOT NULL,
  duplicate_id uuid NOT NULL,
  survivor_updated_at timestamptz NOT NULL,
  duplicate_updated_at timestamptz NOT NULL,
  duplicate_snapshot jsonb,           -- full original row, written at apply
  state text NOT NULL DEFAULT 'planned', -- planned | applied | skipped | undone
  skip_reason text,
  PRIMARY KEY (batch_id, duplicate_id)
);
GRANT ALL ON public.customer_merge_batches, public.customer_merge_pairs TO service_role;
ALTER TABLE public.customer_merge_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_merge_pairs ENABLE ROW LEVEL SECURITY;
-- No policies: salon users cannot read or write these tables.

CREATE OR REPLACE FUNCTION public._dedupe_norm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH a AS (SELECT regexp_replace(coalesce(p,''), '[^0-9+]', '', 'g') AS d),
  b AS (SELECT CASE WHEN d LIKE '+%' THEN substr(d,2) WHEN d LIKE '00%' THEN substr(d,3)
                    WHEN d LIKE '0%' THEN '31'||substr(d,2) ELSE d END AS d FROM a),
  c AS (SELECT CASE WHEN d LIKE '310%' THEN '31'||substr(d,4) ELSE d END AS d FROM b)
  SELECT CASE WHEN length(d) >= 9 THEN d END FROM c $$;

-- Linked tables checked for references. Missing tables are reported, never silently ignored.
CREATE OR REPLACE FUNCTION public._dedupe_linked_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['appointments','treatment_records','treatment_journeys','historical_dossier_entries',
    'clinical_media','form_submissions','form_requests','form_reissue_flags','customer_consents','payments',
    'payment_links','refund_requests','checkout_items','webshop_orders','gift_cards','customer_memberships',
    'membership_usage','customer_alerts','customer_tags','customer_message_preferences','feedback_entries',
    'waitlist_entries','rebook_actions','auto_revenue_offers','automation_logs','automation_runs',
    'autopilot_action_logs','whatsapp_logs','whatsapp_inbound_messages','document_exports','document_shares',
    'legal_holds','privacy_requests'] $$;

CREATE OR REPLACE FUNCTION public._dedupe_ref_count(_id uuid) RETURNS int LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE _t text; _n int; _sum int := 0;
BEGIN
  FOREACH _t IN ARRAY public._dedupe_linked_tables() LOOP
    IF to_regclass('public.'||_t) IS NULL THEN RAISE EXCEPTION 'linked_table_missing:%', _t; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE customer_id = $1', _t) INTO _n USING _id;
    _sum := _sum + _n;
  END LOOP;
  RETURN _sum;
END $$;

-- 1) Preview: plan strong pairs only (same normalised name + email + phone, exactly 2 records,
--    identical consent / communication fields, both unmerged, not archived, not pseudonymised).
--    Survivor = oldest created_at, then lowest id. Returns counts only, no personal data.
CREATE OR REPLACE FUNCTION public.dedupe_preview(_tenant uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE _batch uuid; _planned int; _name_diff int; _consent_diff int; _bigger int;
BEGIN
  INSERT INTO customer_merge_batches(tenant_id) VALUES (_tenant) RETURNING id INTO _batch;
  CREATE TEMP TABLE _g ON COMMIT DROP AS
    SELECT c.*, lower(trim(c.email)) AS ne, _dedupe_norm_phone(c.phone) AS np,
           lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) AS nn
    FROM customers c
    WHERE c.user_id = _tenant AND c.is_demo = false AND c.merged_into IS NULL
      AND c.archived_at IS NULL AND c.pseudonymized_at IS NULL
      AND nullif(trim(c.email),'') IS NOT NULL AND _dedupe_norm_phone(c.phone) IS NOT NULL;
  CREATE TEMP TABLE _k ON COMMIT DROP AS
    SELECT ne, np, count(*) AS n, count(DISTINCT nn) AS names,
      count(DISTINCT (privacy_consent, marketing_consent, whatsapp_opt_in, communication_blocked_at, preferred_language)) AS consents
    FROM _g GROUP BY ne, np HAVING count(*) > 1;
  SELECT count(*) FILTER (WHERE n = 2 AND names > 1),
         count(*) FILTER (WHERE n = 2 AND names = 1 AND consents > 1),
         count(*) FILTER (WHERE n > 2) INTO _name_diff, _consent_diff, _bigger FROM _k;
  INSERT INTO customer_merge_pairs(batch_id, tenant_id, survivor_id, duplicate_id, survivor_updated_at, duplicate_updated_at)
  SELECT _batch, _tenant, s.id, d.id, s.updated_at, d.updated_at
  FROM _k k
  JOIN LATERAL (SELECT * FROM _g g WHERE g.ne = k.ne AND g.np = k.np ORDER BY created_at, id LIMIT 1) s ON true
  JOIN LATERAL (SELECT * FROM _g g WHERE g.ne = k.ne AND g.np = k.np ORDER BY created_at, id OFFSET 1 LIMIT 1) d ON true
  WHERE k.n = 2 AND k.names = 1 AND k.consents = 1;
  GET DIAGNOSTICS _planned = ROW_COUNT;
  UPDATE customer_merge_batches SET stats = jsonb_build_object('planned', _planned,
    'manual_review_name_differs', _name_diff, 'manual_review_consent_differs', _consent_diff,
    'manual_review_groups_over_2', _bigger) WHERE id = _batch;
  RETURN jsonb_build_object('batch', _batch) || (SELECT stats FROM customer_merge_batches WHERE id = _batch);
END $$;

-- 2) Apply (or dry run). Every pair is re-checked under row lock: unchanged since preview,
--    still unmerged, zero references in all linked tables, no legal hold. Otherwise skipped.
CREATE OR REPLACE FUNCTION public.dedupe_apply(_batch uuid, _dry_run boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b customer_merge_batches; _p record; _s customers; _d customers; _reason text;
        _applied int := 0; _skipped jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO _b FROM customer_merge_batches WHERE id = _batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
  IF _b.status <> 'previewed' THEN RETURN jsonb_build_object('noop', _b.status); END IF; -- idempotent
  FOR _p IN SELECT * FROM customer_merge_pairs WHERE batch_id = _batch AND state = 'planned' ORDER BY duplicate_id LOOP
    SELECT * INTO _s FROM customers WHERE id = _p.survivor_id AND user_id = _b.tenant_id FOR UPDATE;
    SELECT * INTO _d FROM customers WHERE id = _p.duplicate_id AND user_id = _b.tenant_id FOR UPDATE;
    _reason := CASE
      WHEN _s.id IS NULL OR _d.id IS NULL THEN 'missing_or_other_tenant'
      WHEN _s.merged_into IS NOT NULL OR _d.merged_into IS NOT NULL THEN 'already_merged'
      WHEN _s.updated_at <> _p.survivor_updated_at OR _d.updated_at <> _p.duplicate_updated_at THEN 'changed_since_preview'
      WHEN EXISTS (SELECT 1 FROM legal_holds WHERE customer_id IN (_s.id, _d.id)) THEN 'legal_hold'
      WHEN _dedupe_ref_count(_d.id) > 0 THEN 'duplicate_has_references'
      END;
    IF _reason IS NOT NULL THEN
      _skipped := _skipped || jsonb_build_object(_reason, coalesce((_skipped->>_reason)::int,0)+1);
      IF NOT _dry_run THEN UPDATE customer_merge_pairs SET state='skipped', skip_reason=_reason
        WHERE batch_id=_batch AND duplicate_id=_p.duplicate_id; END IF;
      CONTINUE;
    END IF;
    _applied := _applied + 1;
    IF NOT _dry_run THEN
      UPDATE customer_merge_pairs SET state='applied', duplicate_snapshot=to_jsonb(_d)
        WHERE batch_id=_batch AND duplicate_id=_p.duplicate_id;
      -- updated_at intentionally left as-is so the original modification date is preserved.
      UPDATE customers SET merged_into=_s.id, merged_at=now(), merge_batch_id=_batch WHERE id=_d.id;
    END IF;
  END LOOP;
  IF NOT _dry_run THEN
    UPDATE customer_merge_batches SET status='applied', applied_at=now(),
      stats = stats || jsonb_build_object('applied', _applied, 'skipped', _skipped) WHERE id=_batch;
    INSERT INTO audit_logs(user_id, action, details) VALUES (_b.tenant_id, 'customer_dedupe_apply',
      jsonb_build_object('batch', _batch, 'applied', _applied, 'skipped', _skipped));
  END IF;
  RETURN jsonb_build_object('dry_run', _dry_run, 'would_apply', _applied, 'skipped', _skipped);
END $$;

-- 3) Undo: restores merge columns from the snapshot; refuses if anyone changed the row since.
CREATE OR REPLACE FUNCTION public.dedupe_undo(_batch uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE _b customer_merge_batches; _n int; _bad int;
BEGIN
  SELECT * INTO _b FROM customer_merge_batches WHERE id=_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
  IF _b.status <> 'applied' THEN RETURN jsonb_build_object('noop', _b.status); END IF;
  SELECT count(*) INTO _bad FROM customer_merge_pairs p JOIN customers c ON c.id=p.duplicate_id
   WHERE p.batch_id=_batch AND p.state='applied'
     AND (c.merge_batch_id IS DISTINCT FROM _batch
          OR (to_jsonb(c) - 'merged_into' - 'merged_at' - 'merge_batch_id')
             <> (p.duplicate_snapshot - 'merged_into' - 'merged_at' - 'merge_batch_id'));
  IF _bad > 0 THEN RAISE EXCEPTION 'undo_conflict:%', _bad; END IF;
  UPDATE customers c SET merged_into=NULL, merged_at=NULL, merge_batch_id=NULL
    FROM customer_merge_pairs p WHERE p.batch_id=_batch AND p.state='applied' AND c.id=p.duplicate_id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE customer_merge_pairs SET state='undone' WHERE batch_id=_batch AND state='applied';
  UPDATE customer_merge_batches SET status='undone', undone_at=now() WHERE id=_batch;
  INSERT INTO audit_logs(user_id, action, details) VALUES (_b.tenant_id, 'customer_dedupe_undo',
    jsonb_build_object('batch', _batch, 'restored', _n));
  RETURN jsonb_build_object('restored', _n);
END $$;

REVOKE ALL ON FUNCTION public.dedupe_preview(uuid), public.dedupe_apply(uuid, boolean), public.dedupe_undo(uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dedupe_preview(uuid), public.dedupe_apply(uuid, boolean), public.dedupe_undo(uuid)
  TO service_role;
