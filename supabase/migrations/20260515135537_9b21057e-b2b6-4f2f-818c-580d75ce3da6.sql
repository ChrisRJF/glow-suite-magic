-- Connected merchants table
CREATE TABLE IF NOT EXISTS public.glowpay_connected_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT true,
  viva_account_id text,
  viva_merchant_id text,
  business_name text,
  contact_email text,
  phone text,
  country text DEFAULT 'NL',
  onboarding_url text,
  onboarding_status text NOT NULL DEFAULT 'not_started',
  kyc_status text,
  payouts_enabled boolean NOT NULL DEFAULT false,
  terminals_enabled boolean NOT NULL DEFAULT false,
  online_payments_enabled boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT glowpay_connected_merchants_status_check CHECK (
    onboarding_status IN ('not_started','invited','in_progress','connected','kyc_pending','active','rejected','suspended')
  )
);

CREATE INDEX IF NOT EXISTS idx_glowpay_cm_user_id ON public.glowpay_connected_merchants(user_id);
CREATE INDEX IF NOT EXISTS idx_glowpay_cm_account_id ON public.glowpay_connected_merchants(viva_account_id);
CREATE INDEX IF NOT EXISTS idx_glowpay_cm_merchant_id ON public.glowpay_connected_merchants(viva_merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_glowpay_cm_user_demo ON public.glowpay_connected_merchants(user_id, is_demo);

ALTER TABLE public.glowpay_connected_merchants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own connected merchant"
  ON public.glowpay_connected_merchants FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own connected merchant"
  ON public.glowpay_connected_merchants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own connected merchant"
  ON public.glowpay_connected_merchants FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own connected merchant"
  ON public.glowpay_connected_merchants FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_glowpay_cm_updated_at
  BEFORE UPDATE ON public.glowpay_connected_merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Terminal readiness: link to connected merchant
ALTER TABLE public.viva_terminals
  ADD COLUMN IF NOT EXISTS connected_merchant_id uuid,
  ADD COLUMN IF NOT EXISTS viva_account_id text;

CREATE INDEX IF NOT EXISTS idx_viva_terminals_connected_merchant
  ON public.viva_terminals(connected_merchant_id);
