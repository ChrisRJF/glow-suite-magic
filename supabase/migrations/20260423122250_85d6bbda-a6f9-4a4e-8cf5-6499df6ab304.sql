CREATE TABLE IF NOT EXISTS public.mollie_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  salon_id uuid NOT NULL,
  mollie_organization_id text,
  mollie_access_token text NOT NULL,
  mollie_refresh_token text NOT NULL,
  mollie_access_token_expires_at timestamptz,
  mollie_mode text NOT NULL DEFAULT 'live',
  account_name text,
  organization_name text,
  onboarding_status text NOT NULL DEFAULT 'unknown',
  webhook_status text NOT NULL DEFAULT 'unknown',
  supported_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_sync_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mollie_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  salon_id uuid NOT NULL,
  state text NOT NULL UNIQUE,
  redirect_to text,
  is_demo boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  mollie_refund_id text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'pending',
  reason text,
  is_demo boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS last_status_sync_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS mollie_method text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS membership_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mollie_connections_one_active_per_salon
ON public.mollie_connections (salon_id)
WHERE is_active = true AND disconnected_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mollie_oauth_states_state ON public.mollie_oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_id ON public.payment_refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_mollie_payment_id ON public.payments (mollie_payment_id);

ALTER TABLE public.mollie_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mollie_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view Mollie connection metadata"
ON public.mollie_connections FOR SELECT
USING (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Owners can create Mollie connections"
ON public.mollie_connections FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Owners can update Mollie connections"
ON public.mollie_connections FOR UPDATE
USING (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Owners can manage Mollie OAuth states"
ON public.mollie_oauth_states FOR ALL
USING (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Finance roles can view refunds in active mode"
ON public.payment_refunds FOR SELECT
USING (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.can_view_finance(auth.uid()));

CREATE POLICY "Owners can create refunds in active mode"
ON public.payment_refunds FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Owners can update refunds in active mode"
ON public.payment_refunds FOR UPDATE
USING (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role]));

DROP TRIGGER IF EXISTS update_mollie_connections_updated_at ON public.mollie_connections;
CREATE TRIGGER update_mollie_connections_updated_at BEFORE UPDATE ON public.mollie_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_payment_refunds_updated_at ON public.payment_refunds;
CREATE TRIGGER update_payment_refunds_updated_at BEFORE UPDATE ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();