-- PROPOSED, NOT APPLIED. Needs explicit approval before running.
-- Controlled, non-destructive customer merge. Nothing is deleted: the duplicate is
-- marked merged_into the kept customer and every linked row is moved, in one transaction.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS merged_into uuid NULL;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.merge_customers(_keep uuid, _dup uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _t text; _n int; _moved jsonb := '{}'::jsonb;
  _tables text[] := ARRAY['appointments','treatment_records','treatment_journeys','historical_dossier_entries',
    'clinical_media','form_submissions','form_requests','form_reissue_flags','customer_consents','payments',
    'payment_links','refund_requests','checkout_items','webshop_orders','gift_cards','customer_memberships',
    'membership_usage','customer_alerts','customer_tags','customer_message_preferences','feedback_entries',
    'waitlist_entries','rebook_actions','auto_revenue_offers','automation_logs','automation_runs',
    'autopilot_action_logs','whatsapp_logs','whatsapp_inbound_messages','document_exports','document_shares',
    'legal_holds','privacy_requests'];
BEGIN
  IF _keep = _dup THEN RAISE EXCEPTION 'same_customer'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::app_role[]) THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Both customers must belong to the caller's own salon and not already be merged.
  PERFORM 1 FROM customers WHERE id IN (_keep,_dup) AND user_id = _tenant AND merged_into IS NULL FOR UPDATE;
  GET DIAGNOSTICS _n = ROW_COUNT; IF _n <> 2 THEN RAISE EXCEPTION 'not_found_or_other_salon'; END IF;
  IF EXISTS (SELECT 1 FROM legal_holds WHERE customer_id IN (_keep,_dup)) THEN RAISE EXCEPTION 'legal_hold'; END IF;
  -- Locked dossier/consent/submission tables have mutation-blocking triggers; the merge must
  -- abort (not bypass them) until a reviewed exception is designed. See README.
  FOREACH _t IN ARRAY _tables LOOP
    EXECUTE format('UPDATE public.%I SET customer_id = $1 WHERE customer_id = $2', _t) USING _keep, _dup;
    GET DIAGNOSTICS _n = ROW_COUNT; IF _n > 0 THEN _moved := _moved || jsonb_build_object(_t, _n); END IF;
  END LOOP;
  UPDATE customers SET merged_into = _keep, merged_at = now() WHERE id = _dup;
  INSERT INTO audit_logs(user_id, action, details) VALUES (_tenant, 'customer_merge',
    jsonb_build_object('keep', _keep, 'dup', _dup, 'moved', _moved, 'actor', auth.uid()));
  RETURN jsonb_build_object('keep', _keep, 'dup', _dup, 'moved', _moved);
END $$;
REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid) TO authenticated;
