CREATE TABLE IF NOT EXISTS public.user_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  member_user_id uuid,
  name text NOT NULL DEFAULT '',
  email text NOT NULL,
  role public.app_role NOT NULL,
  status text NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  last_active_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, email)
);

ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can manage team access in active mode" ON public.user_access;
CREATE POLICY "Owners can manage team access in active mode"
ON public.user_access
FOR ALL
USING (owner_user_id = auth.uid() AND is_demo = public.current_account_is_demo() AND public.can_manage_users(auth.uid()))
WITH CHECK (owner_user_id = auth.uid() AND is_demo = public.current_account_is_demo() AND public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS "Members can view own team access" ON public.user_access;
CREATE POLICY "Members can view own team access"
ON public.user_access
FOR SELECT
USING (member_user_id = auth.uid());

CREATE TRIGGER update_user_access_updated_at
BEFORE UPDATE ON public.user_access
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();