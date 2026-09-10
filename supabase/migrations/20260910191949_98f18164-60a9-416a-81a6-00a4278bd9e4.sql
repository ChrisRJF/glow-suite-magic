ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS pseudonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS pseudonymized_by uuid,
  ADD COLUMN IF NOT EXISTS communication_blocked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_customers_active
  ON public.customers (user_id, is_demo, name)
  WHERE archived_at IS NULL AND pseudonymized_at IS NULL;

CREATE TABLE public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid,
  customer_ref uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('privacy_export','archive','restore','pseudonymize','delete','retention_action')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_progress','database_cleanup_complete','storage_cleanup_pending','completed','blocked','failed','cancelled')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  handled_by uuid,
  result_summary jsonb,
  failure_code text,
  idempotency_key text NOT NULL,
  snapshot_manifest jsonb,
  export_storage_path text,
  export_expires_at timestamptz,
  include_photos boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
GRANT SELECT ON public.privacy_requests TO authenticated;
GRANT ALL ON public.privacy_requests TO service_role;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Privacy managers read tenant requests" ON public.privacy_requests
FOR SELECT TO authenticated USING (
  user_id = public.current_tenant_id()
  AND public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
);
CREATE INDEX idx_privacy_requests_customer ON public.privacy_requests (user_id, customer_ref, requested_at DESC);
CREATE INDEX idx_privacy_requests_status ON public.privacy_requests (status, updated_at);
CREATE TRIGGER update_privacy_requests_updated_at BEFORE UPDATE ON public.privacy_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_ref uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500 AND reason !~ '[<>]'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz
);
GRANT SELECT ON public.legal_holds TO authenticated;
GRANT ALL ON public.legal_holds TO service_role;
ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Privacy managers read tenant legal holds" ON public.legal_holds
FOR SELECT TO authenticated USING (
  user_id = public.current_tenant_id()
  AND public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
);
CREATE UNIQUE INDEX idx_legal_holds_one_active
  ON public.legal_holds (user_id, customer_ref) WHERE released_at IS NULL;
CREATE INDEX idx_legal_holds_customer ON public.legal_holds (user_id, customer_ref, created_at DESC);

CREATE TABLE public.retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  category text NOT NULL CHECK (category IN ('customer_profile','appointments','form_submissions','signed_consents','treatment_records','clinical_media','marketing_consents','audit_logs','generated_exports','document_shares')),
  enabled boolean NOT NULL DEFAULT false,
  retention_months integer CHECK (retention_months IS NULL OR retention_months BETWEEN 1 AND 1200),
  action text NOT NULL DEFAULT 'none' CHECK (action IN ('none','pseudonymize','delete')),
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','needs_review','dry_run_ready','active')),
  dry_run_summary jsonb,
  dry_run_at timestamptz,
  activated_at timestamptz,
  activated_by uuid,
  policy_version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, is_demo, category)
);
GRANT SELECT ON public.retention_policies TO authenticated;
GRANT ALL ON public.retention_policies TO service_role;
ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Privacy policy managers read tenant policies" ON public.retention_policies
FOR SELECT TO authenticated USING (
  user_id = public.current_tenant_id()
  AND public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin']::public.app_role[])
);
CREATE TRIGGER update_retention_policies_updated_at BEFORE UPDATE ON public.retention_policies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.privacy_storage_cleanup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  privacy_request_id uuid NOT NULL REFERENCES public.privacy_requests(id) ON DELETE CASCADE,
  bucket_id text NOT NULL CHECK (bucket_id IN ('clinical-files','dossier-exports')),
  object_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','retry','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (privacy_request_id, bucket_id, object_path)
);
GRANT SELECT ON public.privacy_storage_cleanup TO authenticated;
GRANT ALL ON public.privacy_storage_cleanup TO service_role;
ALTER TABLE public.privacy_storage_cleanup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read tenant cleanup status" ON public.privacy_storage_cleanup
FOR SELECT TO authenticated USING (
  user_id = public.current_tenant_id()
  AND public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_role(auth.uid(), 'eigenaar'::public.app_role)
);
CREATE INDEX idx_privacy_cleanup_pending ON public.privacy_storage_cleanup (status, next_retry_at, created_at);
CREATE TRIGGER update_privacy_storage_cleanup_updated_at BEFORE UPDATE ON public.privacy_storage_cleanup
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.privacy_runtime_controls (
  control_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.privacy_runtime_controls TO service_role;
ALTER TABLE public.privacy_runtime_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only privacy controls" ON public.privacy_runtime_controls
FOR ALL TO service_role USING (true) WITH CHECK (true);
INSERT INTO public.privacy_runtime_controls(control_key, enabled)
VALUES ('retention_processing', false)
ON CONFLICT (control_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_privacy_export()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
$$;
CREATE OR REPLACE FUNCTION public.can_manage_privacy_archive()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
$$;
CREATE OR REPLACE FUNCTION public.can_manage_legal_hold()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
$$;
CREATE OR REPLACE FUNCTION public.can_pseudonymize_customer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin']::public.app_role[])
$$;
CREATE OR REPLACE FUNCTION public.can_delete_customer_data()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
    AND public.has_role(auth.uid(), 'eigenaar'::public.app_role)
$$;
CREATE OR REPLACE FUNCTION public.can_manage_retention()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.can_privacy_export() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_privacy_archive() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_legal_hold() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_pseudonymize_customer() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_delete_customer_data() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_retention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_privacy_export() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_privacy_archive() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_legal_hold() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_pseudonymize_customer() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_delete_customer_data() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_retention() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.customer_privacy_preflight(_tenant_id uuid, _customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.customers%ROWTYPE;
  blockers jsonb := '[]'::jsonb;
  counts jsonb;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id=_customer_id AND user_id=_tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','customer_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM public.legal_holds WHERE user_id=_tenant_id AND customer_ref=_customer_id AND released_at IS NULL) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','legal_hold','label','Bewaarblokkade actief'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) IN ('pending','open','processing','authorized','disputed','chargeback','refund_pending')) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','open_payment','label','Openstaande betaling of financieel geschil'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.gift_cards WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status)='active' AND remaining_amount > 0) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','active_gift_card','label','Actieve cadeaukaart met resterend saldo'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_links WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) IN ('pending','open')) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','open_payment_link','label','Openstaande betaallink'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_memberships WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) IN ('active','paused','payment_pending')) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','active_membership','label','Actief of gepauzeerd abonnement'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.retention_policies WHERE user_id=_tenant_id AND is_demo=c.is_demo AND enabled AND review_status='active' AND action='none') THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','retention_policy','label','Actief bewaarbeleid vereist behoud'));
  END IF;

  SELECT jsonb_build_object(
    'forms',(SELECT count(*) FROM public.form_submissions WHERE user_id=_tenant_id AND customer_id=_customer_id),
    'treatment_records',(SELECT count(*) FROM public.treatment_records WHERE user_id=_tenant_id AND customer_id=_customer_id),
    'photos',(SELECT count(*) FROM public.clinical_media WHERE user_id=_tenant_id AND customer_id=_customer_id),
    'appointments',(SELECT count(*) FROM public.appointments WHERE user_id=_tenant_id AND customer_id=_customer_id),
    'document_shares',(SELECT count(*) FROM public.document_shares WHERE user_id=_tenant_id AND customer_id=_customer_id),
    'exports',(SELECT count(*) FROM public.document_exports WHERE user_id=_tenant_id AND customer_id=_customer_id),
    'alerts',(SELECT count(*) FROM public.customer_alerts WHERE user_id=_tenant_id AND customer_id=_customer_id)
  ) INTO counts;
  RETURN jsonb_build_object('ok',true,'customer_id',_customer_id,'is_demo',c.is_demo,'blocked',jsonb_array_length(blockers)>0,'blockers',blockers,'counts',counts);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_privacy_preflight(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_privacy_preflight(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.block_submission_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.privacy_delete', true)='on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Form submissions are immutable';
END;
$$;
CREATE OR REPLACE FUNCTION public.block_locked_treatment_record_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.privacy_delete', true)='on' THEN RETURN OLD; END IF;
  IF OLD.locked_at IS NOT NULL THEN RAISE EXCEPTION 'Completed treatment records are immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE OR REPLACE FUNCTION public.block_consent_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.privacy_delete', true)='on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'customer_consents is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_customer_privacy_action(
  _request_id uuid,
  _tenant_id uuid,
  _customer_id uuid,
  _actor_id uuid,
  _action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.customers%ROWTYPE;
  pre jsonb;
  now_at timestamptz := now();
BEGIN
  SELECT * INTO c FROM public.customers WHERE id=_customer_id AND user_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','customer_not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.privacy_requests WHERE id=_request_id AND user_id=_tenant_id AND customer_ref=_customer_id FOR UPDATE) THEN
    RETURN jsonb_build_object('ok',false,'error','request_not_found');
  END IF;

  IF _action IN ('archive','restore') AND NOT public.has_any_role(_actor_id, ARRAY['eigenaar','admin','manager']::public.app_role[]) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;
  IF _action='pseudonymize' AND NOT public.has_any_role(_actor_id, ARRAY['eigenaar','admin']::public.app_role[]) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;
  IF _action='delete' AND NOT public.has_role(_actor_id, 'eigenaar'::public.app_role) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

  UPDATE public.privacy_requests SET status='in_progress', started_at=COALESCE(started_at,now_at), handled_by=_actor_id, failure_code=NULL WHERE id=_request_id;

  IF _action='archive' THEN
    UPDATE public.customers SET archived_at=COALESCE(archived_at,now_at), archived_by=_actor_id, communication_blocked_at=COALESCE(communication_blocked_at,now_at) WHERE id=_customer_id AND user_id=_tenant_id;
    UPDATE public.form_requests SET status='cancelled' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('draft','sent','opened');
    UPDATE public.rebook_actions SET status='suppressed' WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) NOT IN ('geboekt','booked','gerealiseerd','vervallen','suppressed','mislukt');
    UPDATE public.automation_runs SET status='skipped', processed_at=now_at, error_message='customer_archived' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('scheduled','retry','pending');
    UPDATE public.privacy_requests SET status='completed', completed_at=now_at, result_summary=jsonb_build_object('archived',true) WHERE id=_request_id;
    RETURN jsonb_build_object('ok',true,'status','completed');
  ELSIF _action='restore' THEN
    UPDATE public.customers SET archived_at=NULL, archived_by=NULL, communication_blocked_at=CASE WHEN pseudonymized_at IS NULL THEN NULL ELSE communication_blocked_at END WHERE id=_customer_id AND user_id=_tenant_id;
    UPDATE public.privacy_requests SET status='completed', completed_at=now_at, result_summary=jsonb_build_object('restored',true) WHERE id=_request_id;
    RETURN jsonb_build_object('ok',true,'status','completed');
  END IF;

  IF EXISTS (SELECT 1 FROM public.legal_holds WHERE user_id=_tenant_id AND customer_ref=_customer_id AND released_at IS NULL) THEN
    UPDATE public.privacy_requests SET status='blocked', failure_code='legal_hold', result_summary=jsonb_build_object('blocked',true,'categories',jsonb_build_array('legal_hold')) WHERE id=_request_id;
    RETURN jsonb_build_object('ok',false,'error','legal_hold');
  END IF;

  IF _action='pseudonymize' THEN
    UPDATE public.customers SET name='Verwijderde klant', email=NULL, phone=NULL, notes=NULL, preferred_language='nl', marketing_consent=false, privacy_consent=false, whatsapp_opt_in=false, archived_at=COALESCE(archived_at,now_at), archived_by=COALESCE(archived_by,_actor_id), pseudonymized_at=now_at, pseudonymized_by=_actor_id, communication_blocked_at=now_at WHERE id=_customer_id AND user_id=_tenant_id;
    INSERT INTO public.customer_message_preferences(user_id,customer_id,is_demo,email_opt_out,sms_opt_out,whatsapp_opt_out,retention_opt_out,retention_opt_out_at)
    VALUES(_tenant_id,_customer_id,c.is_demo,true,true,true,true,now_at)
    ON CONFLICT (user_id,customer_id) DO UPDATE SET email_opt_out=true,sms_opt_out=true,whatsapp_opt_out=true,retention_opt_out=true,retention_opt_out_at=now_at,updated_at=now_at;
    UPDATE public.form_requests SET status='cancelled' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('draft','sent','opened');
    UPDATE public.rebook_actions SET status='suppressed' WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) NOT IN ('geboekt','booked','gerealiseerd','vervallen','suppressed','mislukt');
    UPDATE public.automation_runs SET status='skipped', processed_at=now_at, recipient=NULL, payload='{}'::jsonb, error_message='customer_pseudonymized' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('scheduled','retry','pending');
    UPDATE public.privacy_requests SET status='completed', completed_at=now_at, result_summary=jsonb_build_object('profile_pseudonymized',true,'immutable_documents_preserved',true,'residual_personal_data_possible',true) WHERE id=_request_id;
    RETURN jsonb_build_object('ok',true,'status','completed');
  ELSIF _action='delete' THEN
    pre := public.customer_privacy_preflight(_tenant_id,_customer_id);
    IF COALESCE((pre->>'blocked')::boolean,false) THEN
      UPDATE public.privacy_requests SET status='blocked', failure_code='preflight_blocked', result_summary=jsonb_build_object('blocked',true,'blockers',pre->'blockers') WHERE id=_request_id;
      RETURN jsonb_build_object('ok',false,'error','blocked','preflight',pre);
    END IF;

    INSERT INTO public.privacy_storage_cleanup(user_id,is_demo,privacy_request_id,bucket_id,object_path)
      SELECT _tenant_id,c.is_demo,_request_id,'clinical-files',storage_path FROM public.clinical_media WHERE user_id=_tenant_id AND customer_id=_customer_id
      ON CONFLICT DO NOTHING;
    INSERT INTO public.privacy_storage_cleanup(user_id,is_demo,privacy_request_id,bucket_id,object_path)
      SELECT _tenant_id,c.is_demo,_request_id,'dossier-exports',storage_path FROM public.document_exports WHERE user_id=_tenant_id AND customer_id=_customer_id AND storage_path IS NOT NULL
      ON CONFLICT DO NOTHING;

    UPDATE public.document_shares SET status='revoked', revoked_at=now_at, revoked_by=_actor_id WHERE user_id=_tenant_id AND customer_id=_customer_id AND status='active';
    UPDATE public.form_requests SET status='cancelled' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('draft','sent','opened');
    UPDATE public.rebook_actions SET status='suppressed' WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) NOT IN ('geboekt','booked','gerealiseerd','vervallen','suppressed','mislukt');
    UPDATE public.automation_runs SET status='skipped', processed_at=now_at, recipient=NULL, payload='{}'::jsonb, error_message='customer_deleted' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('scheduled','retry','pending');

    PERFORM set_config('app.privacy_delete','on',true);
    DELETE FROM public.customer_consents WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.form_submissions WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.treatment_records WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.form_requests WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.clinical_media WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.customer_alerts WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.form_reissue_flags WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.auto_revenue_offers WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.customer_message_preferences WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.document_shares WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.document_exports WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.whatsapp_inbound_messages WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.waitlist_entries WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.feedback_entries WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.automation_logs WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.automation_runs SET customer_id=NULL, recipient=NULL, payload='{}'::jsonb, error_message=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.whatsapp_logs SET customer_id=NULL, to_number='[verwijderd]', message='[verwijderd]', error=NULL, confirmation_link=NULL, booking_token=NULL, meta='{}'::jsonb WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.rebook_actions SET customer_id=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.appointments SET customer_id=NULL, notes='' WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.payments SET customer_id=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.gift_cards SET customer_id=NULL, customer_name=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.payment_links SET customer_id=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.checkout_items SET customer_id=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    UPDATE public.customer_memberships SET customer_id=NULL WHERE user_id=_tenant_id AND customer_id=_customer_id;
    DELETE FROM public.customers WHERE id=_customer_id AND user_id=_tenant_id;

    UPDATE public.privacy_requests SET customer_id=NULL, status=CASE WHEN EXISTS(SELECT 1 FROM public.privacy_storage_cleanup WHERE privacy_request_id=_request_id AND status<>'completed') THEN 'storage_cleanup_pending' ELSE 'completed' END, completed_at=CASE WHEN EXISTS(SELECT 1 FROM public.privacy_storage_cleanup WHERE privacy_request_id=_request_id AND status<>'completed') THEN NULL ELSE now_at END, result_summary=jsonb_build_object('database_cleanup_complete',true,'storage_cleanup_pending',EXISTS(SELECT 1 FROM public.privacy_storage_cleanup WHERE privacy_request_id=_request_id AND status<>'completed')) WHERE id=_request_id;
    RETURN jsonb_build_object('ok',true,'status',(SELECT status FROM public.privacy_requests WHERE id=_request_id));
  END IF;
  RETURN jsonb_build_object('ok',false,'error','unknown_action');
END;
$$;
REVOKE ALL ON FUNCTION public.execute_customer_privacy_action(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_customer_privacy_action(uuid,uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.retention_policy_needs_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.category,NEW.retention_months,NEW.action) IS DISTINCT FROM (OLD.category,OLD.retention_months,OLD.action) THEN
    NEW.enabled := false;
    NEW.review_status := 'needs_review';
    NEW.dry_run_summary := NULL;
    NEW.dry_run_at := NULL;
    NEW.activated_at := NULL;
    NEW.activated_by := NULL;
    NEW.policy_version := OLD.policy_version + 1;
  END IF;
  IF NEW.review_status <> 'active' THEN NEW.enabled := false; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retention_policy_review_guard BEFORE INSERT OR UPDATE ON public.retention_policies
FOR EACH ROW EXECUTE FUNCTION public.retention_policy_needs_review();

CREATE OR REPLACE FUNCTION public.retention_dry_run(_tenant_id uuid, _is_demo boolean, _category text, _months integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cutoff timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(months=>_months);
DECLARE customers_count bigint := 0; documents_count bigint := 0; photos_count bigint := 0; held_count bigint := 0;
BEGIN
  IF _months < 1 THEN RETURN jsonb_build_object('ok',false,'error','invalid_retention'); END IF;
  SELECT count(DISTINCT c.id) INTO customers_count FROM public.customers c WHERE c.user_id=_tenant_id AND c.is_demo=_is_demo AND c.created_at < cutoff;
  SELECT count(*) INTO documents_count FROM public.form_submissions f WHERE f.user_id=_tenant_id AND f.is_demo=_is_demo AND f.created_at < cutoff;
  SELECT count(*) INTO photos_count FROM public.clinical_media m WHERE m.user_id=_tenant_id AND m.is_demo=_is_demo AND m.created_at < cutoff;
  SELECT count(*) INTO held_count FROM public.legal_holds h WHERE h.user_id=_tenant_id AND h.is_demo=_is_demo AND h.released_at IS NULL;
  RETURN jsonb_build_object('ok',true,'category',_category,'cutoff_utc',cutoff,'customers',customers_count,'documents',documents_count,'photos',photos_count,'legal_holds_skipped',held_count,'mutations',0);
END;
$$;
REVOKE ALL ON FUNCTION public.retention_dry_run(uuid,boolean,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_dry_run(uuid,boolean,text,integer) TO service_role;