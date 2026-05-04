
-- 1) whatsapp_inbound_messages
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  from_number text NOT NULL,
  body text NOT NULL DEFAULT '',
  processed boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_inbound_user_mode ON public.whatsapp_inbound_messages(user_id, is_demo, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_processed ON public.whatsapp_inbound_messages(processed, received_at DESC);

ALTER TABLE public.whatsapp_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own inbound messages in active mode"
  ON public.whatsapp_inbound_messages FOR SELECT
  USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Users can insert their own inbound messages in active mode"
  ON public.whatsapp_inbound_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());

CREATE POLICY "Users can update their own inbound messages in active mode"
  ON public.whatsapp_inbound_messages FOR UPDATE
  USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Users can delete their own inbound messages in active mode"
  ON public.whatsapp_inbound_messages FOR DELETE
  USING (public.user_row_matches_active_mode(user_id, is_demo));

-- 2) auto_revenue_offers
CREATE TABLE IF NOT EXISTS public.auto_revenue_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  employee_id text,
  appointment_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','pending_payment','paid','expired','cancelled','failed')),
  expires_at timestamptz NOT NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offers_user_mode_status ON public.auto_revenue_offers(user_id, is_demo, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_customer ON public.auto_revenue_offers(customer_id, status);

ALTER TABLE public.auto_revenue_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own offers in active mode"
  ON public.auto_revenue_offers FOR SELECT
  USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Users can insert their own offers in active mode"
  ON public.auto_revenue_offers FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());

CREATE POLICY "Users can update their own offers in active mode"
  ON public.auto_revenue_offers FOR UPDATE
  USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Users can delete their own offers in active mode"
  ON public.auto_revenue_offers FOR DELETE
  USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE TRIGGER trg_auto_revenue_offers_updated_at
  BEFORE UPDATE ON public.auto_revenue_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) appointments — add payment_expires_at
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_appointments_payment_expires
  ON public.appointments(status, payment_expires_at)
  WHERE status = 'pending_payment';

-- 4) settings — deposit & hold config
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS auto_revenue_deposit_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_revenue_deposit_type text NOT NULL DEFAULT 'fixed' CHECK (auto_revenue_deposit_type IN ('fixed','percentage')),
  ADD COLUMN IF NOT EXISTS auto_revenue_deposit_fixed_cents integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS auto_revenue_deposit_percentage_bps integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS auto_revenue_deposit_min_cents integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS auto_revenue_deposit_max_cents integer NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS auto_revenue_reservation_hold_minutes integer NOT NULL DEFAULT 15;
