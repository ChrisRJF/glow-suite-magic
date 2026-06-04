
-- 1) Lock down referral_codes: stop exposing the whole table to anon.
DROP POLICY IF EXISTS "Anyone can lookup code on signup" ON public.referral_codes;

-- Provide a safe, scoped lookup helper for anonymous signup flow.
CREATE OR REPLACE FUNCTION public.lookup_referral_owner(_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.referral_codes WHERE code = upper(_code) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.lookup_referral_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_referral_owner(text) TO anon, authenticated;

-- 2) Stop exposing whatsapp scheduler operational metrics across tenants.
DROP POLICY IF EXISTS "Authenticated can view scheduler runs" ON public.whatsapp_scheduler_runs;
-- service_role bypasses RLS; edge functions keep full access.
