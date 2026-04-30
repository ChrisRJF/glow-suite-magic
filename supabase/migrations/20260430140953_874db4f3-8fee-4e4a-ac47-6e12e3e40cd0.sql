ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS send_revenue_boost boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revenue_boost_after_days integer NOT NULL DEFAULT 42,
  ADD COLUMN IF NOT EXISTS revenue_boost_max_per_month integer NOT NULL DEFAULT 1;

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS last_offer_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_offered_slot text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_kind_customer
  ON public.whatsapp_logs (user_id, customer_id, kind, created_at DESC);
