DROP POLICY IF EXISTS "Users insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users update own subscription" ON public.subscriptions;
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated, anon;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;