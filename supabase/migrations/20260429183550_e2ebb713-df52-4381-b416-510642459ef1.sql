
-- WhatsApp settings (one per user)
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  from_number TEXT NOT NULL DEFAULT 'whatsapp:+14155238886',
  send_booking_confirmation BOOLEAN NOT NULL DEFAULT true,
  send_reminders BOOLEAN NOT NULL DEFAULT true,
  reminder_hours_before INT NOT NULL DEFAULT 24,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own whatsapp settings"
  ON public.whatsapp_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_whatsapp_settings_updated_at
  BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- WhatsApp message logs
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  customer_id UUID,
  appointment_id UUID,
  to_number TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  twilio_sid TEXT,
  error TEXT,
  kind TEXT NOT NULL DEFAULT 'confirmation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_user ON public.whatsapp_logs(user_id, created_at DESC);

ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own whatsapp logs"
  ON public.whatsapp_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own whatsapp logs"
  ON public.whatsapp_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Add opt-in to customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN DEFAULT true;
