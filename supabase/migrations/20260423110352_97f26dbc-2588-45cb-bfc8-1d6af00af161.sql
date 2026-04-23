CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view audit logs in active mode" ON public.audit_logs;
CREATE POLICY "Owners can view audit logs in active mode"
ON public.audit_logs
FOR SELECT
USING (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
  AND (
    public.has_role(auth.uid(), 'eigenaar'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
);

DROP POLICY IF EXISTS "System can insert audit logs for authenticated users" ON public.audit_logs;
CREATE POLICY "System can insert audit logs for authenticated users"
ON public.audit_logs
FOR INSERT
WITH CHECK (
  auth.uid() = actor_user_id
  AND user_id = actor_user_id
  AND is_demo = public.current_account_is_demo()
);

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_users(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'eigenaar'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.can_view_finance(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_any_role(_user_id, ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'financieel'::public.app_role])
$$;

CREATE OR REPLACE FUNCTION public.can_manage_operations(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_any_role(_user_id, ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'medewerker'::public.app_role, 'receptie'::public.app_role])
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'invited_by', '') = '' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'eigenaar'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "Owners can manage roles" ON public.user_roles;
CREATE POLICY "Owners can manage roles"
ON public.user_roles
FOR ALL
USING (public.can_manage_users(auth.uid()))
WITH CHECK (public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS "Users can view payments in active mode" ON public.payments;
CREATE POLICY "Finance roles can view payments in active mode"
ON public.payments
FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Users can insert payments in active mode" ON public.payments;
CREATE POLICY "Finance roles can insert payments in active mode"
ON public.payments
FOR INSERT
WITH CHECK ((auth.uid() = user_id) AND (is_demo = public.current_account_is_demo()) AND public.can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Users can update payments in active mode" ON public.payments;
CREATE POLICY "Finance roles can update payments in active mode"
ON public.payments
FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()))
WITH CHECK ((auth.uid() = user_id) AND (is_demo = public.current_account_is_demo()) AND public.can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Users can delete payments in active mode" ON public.payments;
CREATE POLICY "Owners can delete payments in active mode"
ON public.payments
FOR DELETE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_role(auth.uid(), 'eigenaar'::public.app_role));

DROP POLICY IF EXISTS "Users can view payment links in active mode" ON public.payment_links;
CREATE POLICY "Finance roles can view payment links in active mode"
ON public.payment_links
FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Users can insert payment links in active mode" ON public.payment_links;
CREATE POLICY "Finance roles can insert payment links in active mode"
ON public.payment_links
FOR INSERT
WITH CHECK ((auth.uid() = user_id) AND (is_demo = public.current_account_is_demo()) AND public.can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Users can update payment links in active mode" ON public.payment_links;
CREATE POLICY "Finance roles can update payment links in active mode"
ON public.payment_links
FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()))
WITH CHECK ((auth.uid() = user_id) AND (is_demo = public.current_account_is_demo()) AND public.can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Users can delete payment links in active mode" ON public.payment_links;
CREATE POLICY "Owners can delete payment links in active mode"
ON public.payment_links
FOR DELETE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_role(auth.uid(), 'eigenaar'::public.app_role));