ALTER FUNCTION public.can_privacy_export() SECURITY INVOKER;
ALTER FUNCTION public.can_manage_privacy_archive() SECURITY INVOKER;
ALTER FUNCTION public.can_manage_legal_hold() SECURITY INVOKER;
ALTER FUNCTION public.can_pseudonymize_customer() SECURITY INVOKER;
ALTER FUNCTION public.can_delete_customer_data() SECURITY INVOKER;
ALTER FUNCTION public.can_manage_retention() SECURITY INVOKER;

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
  event_name text;
  next_status text;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id=_customer_id AND user_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','customer_not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.privacy_requests WHERE id=_request_id AND user_id=_tenant_id AND customer_ref=_customer_id FOR UPDATE) THEN
    RETURN jsonb_build_object('ok',false,'error','request_not_found');
  END IF;

  IF _action IN ('archive','restore') AND NOT public.has_any_role(_actor_id, ARRAY['eigenaar','admin','manager']::public.app_role[]) THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF _action='pseudonymize' AND NOT public.has_any_role(_actor_id, ARRAY['eigenaar','admin']::public.app_role[]) THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF _action='delete' AND NOT public.has_role(_actor_id, 'eigenaar'::public.app_role) THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;

  UPDATE public.privacy_requests SET status='in_progress', started_at=COALESCE(started_at,now_at), handled_by=_actor_id, failure_code=NULL WHERE id=_request_id;

  IF _action='archive' THEN
    UPDATE public.customers SET archived_at=COALESCE(archived_at,now_at), archived_by=_actor_id, communication_blocked_at=COALESCE(communication_blocked_at,now_at) WHERE id=_customer_id AND user_id=_tenant_id;
    UPDATE public.form_requests SET status='cancelled' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('draft','sent','opened');
    UPDATE public.rebook_actions SET status='suppressed' WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) NOT IN ('geboekt','booked','gerealiseerd','vervallen','suppressed','mislukt');
    UPDATE public.automation_runs SET status='skipped', processed_at=now_at, error_message='customer_archived' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('scheduled','retry','pending');
    UPDATE public.privacy_requests SET status='completed', completed_at=now_at, result_summary=jsonb_build_object('archived',true) WHERE id=_request_id;
    event_name := 'customer_archived';
  ELSIF _action='restore' THEN
    UPDATE public.customers SET archived_at=NULL, archived_by=NULL, communication_blocked_at=CASE WHEN pseudonymized_at IS NULL THEN NULL ELSE communication_blocked_at END WHERE id=_customer_id AND user_id=_tenant_id;
    UPDATE public.privacy_requests SET status='completed', completed_at=now_at, result_summary=jsonb_build_object('restored',true) WHERE id=_request_id;
    event_name := 'customer_restored';
  ELSE
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
      event_name := 'customer_pseudonymized';
    ELSIF _action='delete' THEN
      pre := public.customer_privacy_preflight(_tenant_id,_customer_id);
      IF COALESCE((pre->>'blocked')::boolean,false) THEN
        UPDATE public.privacy_requests SET status='blocked', failure_code='preflight_blocked', result_summary=jsonb_build_object('blocked',true,'blockers',pre->'blockers') WHERE id=_request_id;
        INSERT INTO public.audit_logs(user_id,actor_user_id,action,target_type,target_id,is_demo,details)
        VALUES(_tenant_id,_actor_id,'customer_deletion_blocked','privacy_request',_request_id::text,c.is_demo,jsonb_build_object('request_type','delete','blocker_codes',(SELECT jsonb_agg(x->>'code') FROM jsonb_array_elements(pre->'blockers') x)));
        RETURN jsonb_build_object('ok',false,'error','blocked','preflight',pre);
      END IF;

      INSERT INTO public.privacy_storage_cleanup(user_id,is_demo,privacy_request_id,bucket_id,object_path)
        SELECT _tenant_id,c.is_demo,_request_id,'clinical-files',storage_path FROM public.clinical_media WHERE user_id=_tenant_id AND customer_id=_customer_id ON CONFLICT DO NOTHING;
      INSERT INTO public.privacy_storage_cleanup(user_id,is_demo,privacy_request_id,bucket_id,object_path)
        SELECT _tenant_id,c.is_demo,_request_id,'dossier-exports',storage_path FROM public.document_exports WHERE user_id=_tenant_id AND customer_id=_customer_id AND storage_path IS NOT NULL ON CONFLICT DO NOTHING;
      UPDATE public.document_shares SET status='revoked', revoked_at=now_at, revoked_by=_actor_id WHERE user_id=_tenant_id AND customer_id=_customer_id AND status='active';
      INSERT INTO public.audit_logs(user_id,actor_user_id,action,target_type,target_id,is_demo,details)
      SELECT _tenant_id,_actor_id,'privacy_cleanup_share_revoked','privacy_request',_request_id::text,c.is_demo,jsonb_build_object('share_count',count(*)) FROM public.document_shares WHERE user_id=_tenant_id AND customer_id=_customer_id;
      UPDATE public.form_requests SET status='cancelled' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('draft','sent','opened');
      UPDATE public.rebook_actions SET status='suppressed' WHERE user_id=_tenant_id AND customer_id=_customer_id AND lower(status) NOT IN ('geboekt','booked','gerealiseerd','vervallen','suppressed','mislukt');
      UPDATE public.automation_runs SET status='skipped', processed_at=now_at, recipient=NULL, payload='{}'::jsonb, error_message='customer_deleted' WHERE user_id=_tenant_id AND customer_id=_customer_id AND status IN ('scheduled','retry','pending');

      PERFORM set_config('app.privacy_delete','on',true);
      DELETE FROM public.customer_consents WHERE user_id=_tenant_id AND customer_id=_customer_id;
      DELETE FROM public.form_submissions WHERE user_id=_tenant_id AND customer_id=_customer_id;
      DELETE FROM public.form_requests WHERE user_id=_tenant_id AND customer_id=_customer_id;
      DELETE FROM public.clinical_media WHERE user_id=_tenant_id AND customer_id=_customer_id;
      DELETE FROM public.treatment_records WHERE user_id=_tenant_id AND customer_id=_customer_id;
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

      SELECT CASE WHEN EXISTS(SELECT 1 FROM public.privacy_storage_cleanup WHERE privacy_request_id=_request_id AND status<>'completed') THEN 'storage_cleanup_pending' ELSE 'completed' END INTO next_status;
      UPDATE public.privacy_requests SET customer_id=NULL,status=next_status,completed_at=CASE WHEN next_status='completed' THEN now_at ELSE NULL END,result_summary=jsonb_build_object('database_cleanup_complete',true,'storage_cleanup_pending',next_status='storage_cleanup_pending') WHERE id=_request_id;
      event_name := 'customer_deleted';
    ELSE
      RETURN jsonb_build_object('ok',false,'error','unknown_action');
    END IF;
  END IF;

  INSERT INTO public.audit_logs(user_id,actor_user_id,action,target_type,target_id,is_demo,details)
  VALUES(_tenant_id,_actor_id,event_name,'privacy_request',_request_id::text,c.is_demo,jsonb_build_object('request_type',_action,'status',COALESCE(next_status,'completed')));
  RETURN jsonb_build_object('ok',true,'status',COALESCE(next_status,'completed'));
END;
$$;