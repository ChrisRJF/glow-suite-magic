REVOKE EXECUTE ON FUNCTION public.appointment_dossier_status(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.appointment_dossier_status(uuid[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.block_locked_treatment_record_change() FROM anon, public, authenticated;