CREATE TABLE IF NOT EXISTS public.membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  billing_interval text NOT NULL DEFAULT 'monthly',
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_treatments integer NOT NULL DEFAULT 0,
  discount_percentage numeric NOT NULL DEFAULT 0,
  priority_booking boolean NOT NULL DEFAULT false,
  credits_reset boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid,
  membership_plan_id uuid NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  current_period_start date NOT NULL DEFAULT CURRENT_DATE,
  current_period_end date,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  paused_at timestamptz,
  cancelled_at timestamptz,
  credits_available integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  mollie_customer_id text,
  mollie_subscription_id text,
  next_payment_at timestamptz,
  last_payment_status text NOT NULL DEFAULT 'open',
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.membership_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_membership_id uuid NOT NULL REFERENCES public.customer_memberships(id) ON DELETE CASCADE,
  customer_id uuid,
  appointment_id uuid,
  service_id uuid,
  benefit_type text NOT NULL DEFAULT 'credit',
  credits_used integer NOT NULL DEFAULT 1,
  discount_amount numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  used_at timestamptz NOT NULL DEFAULT now(),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS membership_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS customer_memberships_one_active_idx
ON public.customer_memberships(user_id, customer_id, membership_plan_id)
WHERE status IN ('active', 'payment_issue', 'paused');

CREATE INDEX IF NOT EXISTS membership_plans_user_idx ON public.membership_plans(user_id, is_demo, is_active);
CREATE INDEX IF NOT EXISTS customer_memberships_user_idx ON public.customer_memberships(user_id, is_demo, status);
CREATE INDEX IF NOT EXISTS membership_usage_user_idx ON public.membership_usage(user_id, is_demo, customer_membership_id);

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view membership plans in active mode" ON public.membership_plans;
CREATE POLICY "Users can view membership plans in active mode"
ON public.membership_plans FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Users can insert membership plans in active mode" ON public.membership_plans;
CREATE POLICY "Users can insert membership plans in active mode"
ON public.membership_plans FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

DROP POLICY IF EXISTS "Users can update membership plans in active mode" ON public.membership_plans;
CREATE POLICY "Users can update membership plans in active mode"
ON public.membership_plans FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

DROP POLICY IF EXISTS "Users can delete membership plans in active mode" ON public.membership_plans;
CREATE POLICY "Users can delete membership plans in active mode"
ON public.membership_plans FOR DELETE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_role(auth.uid(), 'eigenaar'::public.app_role));

DROP POLICY IF EXISTS "Users can view customer memberships in active mode" ON public.customer_memberships;
CREATE POLICY "Users can view customer memberships in active mode"
ON public.customer_memberships FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Users can insert customer memberships in active mode" ON public.customer_memberships;
CREATE POLICY "Users can insert customer memberships in active mode"
ON public.customer_memberships FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

DROP POLICY IF EXISTS "Users can update customer memberships in active mode" ON public.customer_memberships;
CREATE POLICY "Users can update customer memberships in active mode"
ON public.customer_memberships FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'financieel'::public.app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'financieel'::public.app_role]));

DROP POLICY IF EXISTS "Users can delete customer memberships in active mode" ON public.customer_memberships;
CREATE POLICY "Users can delete customer memberships in active mode"
ON public.customer_memberships FOR DELETE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_role(auth.uid(), 'eigenaar'::public.app_role));

DROP POLICY IF EXISTS "Users can view membership usage in active mode" ON public.membership_usage;
CREATE POLICY "Users can view membership usage in active mode"
ON public.membership_usage FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Users can insert membership usage in active mode" ON public.membership_usage;
CREATE POLICY "Users can insert membership usage in active mode"
ON public.membership_usage FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());

DROP POLICY IF EXISTS "Users can update membership usage in active mode" ON public.membership_usage;
CREATE POLICY "Users can update membership usage in active mode"
ON public.membership_usage FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());

DROP TRIGGER IF EXISTS update_membership_plans_updated_at ON public.membership_plans;
CREATE TRIGGER update_membership_plans_updated_at
BEFORE UPDATE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_memberships_updated_at ON public.customer_memberships;
CREATE TRIGGER update_customer_memberships_updated_at
BEFORE UPDATE ON public.customer_memberships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.reset_due_membership_credits(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer := 0;
BEGIN
  UPDATE public.customer_memberships cm
  SET credits_available = mp.included_treatments,
      credits_used = 0,
      current_period_start = CURRENT_DATE,
      current_period_end = (CURRENT_DATE + interval '1 month')::date,
      updated_at = now()
  FROM public.membership_plans mp
  WHERE cm.membership_plan_id = mp.id
    AND cm.user_id = _user_id
    AND cm.status = 'active'
    AND mp.credits_reset = true
    AND COALESCE(cm.current_period_end, CURRENT_DATE) <= CURRENT_DATE;

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;