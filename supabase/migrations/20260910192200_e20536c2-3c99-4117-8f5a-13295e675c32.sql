CREATE OR REPLACE FUNCTION public.build_privacy_export_snapshot(_tenant_id uuid, _customer_id uuid, _as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id=_customer_id AND user_id=_tenant_id) THEN
    RETURN jsonb_build_object('ok',false,'error','customer_not_found');
  END IF;
  SELECT jsonb_build_object(
    'schema_version','1.0',
    'generated_at',_as_of,
    'customer',(SELECT to_jsonb(x) FROM (SELECT id,name,email,phone,notes,created_at,updated_at,is_vip,no_show_count,cancellation_count,loyalty_points,marketing_consent,privacy_consent,whatsapp_opt_in,preferred_language,archived_at,pseudonymized_at FROM public.customers WHERE id=_customer_id AND user_id=_tenant_id) x),
    'appointments',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.appointment_date) FROM (SELECT id,appointment_date,start_time,end_time,status,price,notes,created_at,updated_at,payment_required,payment_status,deposit_amount,amount_paid,source,booking_reference,payment_type,confirmation_status,confirmation_responded_at FROM public.appointments WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'form_requests',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,appointment_id,template_id,template_version_id,status,channel,expires_at,sent_at,opened_at,completed_at,created_at FROM public.form_requests WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'form_submissions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.submitted_at) FROM (SELECT id,request_id,appointment_id,template_id,template_version_id,answers,rendered_snapshot,document_hash,signer_name,signed_at,signature_data,audit_metadata,submitted_at,created_at FROM public.form_submissions WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'treatment_records',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,appointment_id,template_id,template_version,service_id,employee_id,status,values,template_snapshot,completed_at,locked_at,created_at,updated_at FROM public.treatment_records WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'media',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,appointment_id,treatment_record_id,category,caption,mime_type,size_bytes,created_at,marketing_approved,marketing_approved_at FROM public.clinical_media WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'alerts',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,source_type,source_id,label,review_status,reviewed_at,created_at FROM public.customer_alerts WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'consent_history',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at,x.seq) FROM (SELECT id,consent_type,scope,event,occurred_at,source,version,note,created_at,seq FROM public.customer_consents WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'communications',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,appointment_id,status,kind,reminder_type,created_at,CASE WHEN message LIKE '%/document/%' THEN '[beveiligd documentbericht]' ELSE message END AS message FROM public.whatsapp_logs WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'document_shares',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,export_id,status,max_downloads,download_count,first_viewed_at,last_downloaded_at,revoked_at,expires_at,created_at FROM public.document_shares WHERE user_id=_tenant_id AND customer_id=_customer_id AND created_at<=_as_of) x),'[]'::jsonb),
    'audit_events',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (SELECT id,action,target_type,target_id,created_at FROM public.audit_logs WHERE user_id=_tenant_id AND created_at<=_as_of AND (target_id=_customer_id::text OR details->>'customer_id'=_customer_id::text)) x),'[]'::jsonb)
  ) INTO result;
  RETURN jsonb_build_object('ok',true,'snapshot',result);
END;
$$;
REVOKE ALL ON FUNCTION public.build_privacy_export_snapshot(uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_privacy_export_snapshot(uuid,uuid,timestamptz) TO service_role;