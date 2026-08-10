ALTER TABLE public.glowpay_connected_merchants
  ADD COLUMN IF NOT EXISTS viva_source_code text,
  ADD COLUMN IF NOT EXISTS reseller_source_code text,
  ADD COLUMN IF NOT EXISTS setup_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setup_incomplete_reason text;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS viva_merchant_id text,
  ADD COLUMN IF NOT EXISTS viva_source_code text;

ALTER TABLE public.viva_webhook_events
  ADD COLUMN IF NOT EXISTS viva_merchant_id text;

CREATE INDEX IF NOT EXISTS idx_payments_viva_merchant_id ON public.payments (viva_merchant_id) WHERE viva_merchant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gcm_viva_merchant_id ON public.glowpay_connected_merchants (viva_merchant_id) WHERE viva_merchant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vwe_viva_merchant_id ON public.viva_webhook_events (viva_merchant_id) WHERE viva_merchant_id IS NOT NULL;