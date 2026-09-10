
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cnt integer;
  _owner uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'eigenaar'::public.app_role) THEN
    RETURN _uid;
  END IF;

  SELECT count(*), max(owner_user_id)
    INTO _cnt, _owner
  FROM (
    SELECT DISTINCT ua.owner_user_id
    FROM public.user_access ua
    WHERE ua.member_user_id = _uid
      AND ua.status = 'active'
  ) s;

  IF _cnt = 1 THEN
    RETURN _owner;
  END IF;

  IF _cnt > 1 THEN
    RAISE WARNING 'current_tenant_id: ambiguous tenant membership for user %', _uid;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;
