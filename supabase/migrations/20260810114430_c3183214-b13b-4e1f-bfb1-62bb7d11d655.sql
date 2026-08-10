REVOKE ALL ON FUNCTION public.claim_auto_rebook(uuid, uuid, uuid, date, integer, text, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auto_rebook(uuid, uuid, uuid, date, integer, text, numeric, boolean) TO service_role;
