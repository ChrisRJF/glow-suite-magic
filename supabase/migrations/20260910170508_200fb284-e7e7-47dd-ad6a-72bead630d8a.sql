REVOKE ALL ON FUNCTION public.enqueue_dossier_automation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.determine_required_forms_for_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.determine_required_forms_for_appointment(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.customer_dossier_timeline(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_dossier_timeline(uuid, integer, integer) TO authenticated, service_role;