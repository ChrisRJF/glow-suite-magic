
REVOKE ALL ON FUNCTION public.try_acquire_scheduler_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_scheduler_lock(text, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.release_scheduler_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_scheduler_lock(text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_reminder_dispatch(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_dispatch(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.check_public_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_public_rate_limit(text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_noshow_prevention(boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_noshow_prevention(boolean, text, text, text) TO authenticated, service_role;
