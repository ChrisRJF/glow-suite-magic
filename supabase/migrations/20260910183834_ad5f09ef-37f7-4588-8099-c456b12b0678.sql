
CREATE OR REPLACE FUNCTION public.block_consent_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'customer_consents is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.current_consent_status(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.can_use_media_for_marketing(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.can_manage_consent() FROM public, anon;
REVOKE ALL ON FUNCTION public.can_view_consent_history() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_consent_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_use_media_for_marketing(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_consent() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_consent_history() TO authenticated, service_role;
