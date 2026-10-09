REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenant_feature_flags FROM authenticated, anon;
REVOKE ALL ON public.tenant_feature_flags FROM anon;