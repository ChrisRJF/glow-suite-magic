
-- 1. Webhook security columns (additive, safe)
ALTER TABLE public.viva_webhook_events
  ADD COLUMN IF NOT EXISTS signature_valid boolean,
  ADD COLUMN IF NOT EXISTS suspicious boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspicious_reason text;

CREATE INDEX IF NOT EXISTS viva_webhook_events_suspicious_idx
  ON public.viva_webhook_events (created_at DESC)
  WHERE suspicious = true;

-- 2. Payouts
CREATE TABLE IF NOT EXISTS public.viva_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  payout_id text NOT NULL,
  merchant_id text,
  source_code text,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  payout_date date,
  payout_status text NOT NULL DEFAULT 'pending',
  mismatch boolean NOT NULL DEFAULT false,
  mismatch_reason text,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS viva_payouts_user_payout_uidx
  ON public.viva_payouts (user_id, payout_id);
CREATE INDEX IF NOT EXISTS viva_payouts_user_date_idx
  ON public.viva_payouts (user_id, payout_date DESC);

ALTER TABLE public.viva_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "viva_payouts_owner_select" ON public.viva_payouts
  FOR SELECT USING (auth.uid() = user_id);

-- 3. Payout transactions
CREATE TABLE IF NOT EXISTS public.viva_payout_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  payout_id uuid REFERENCES public.viva_payouts(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  viva_transaction_id text,
  viva_order_code text,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  transaction_date timestamptz,
  matched boolean NOT NULL DEFAULT false,
  mismatch_reason text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS viva_payout_tx_unique_uidx
  ON public.viva_payout_transactions (user_id, payout_id, viva_transaction_id);
CREATE INDEX IF NOT EXISTS viva_payout_tx_payment_idx
  ON public.viva_payout_transactions (payment_id);

ALTER TABLE public.viva_payout_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "viva_payout_tx_owner_select" ON public.viva_payout_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- updated_at trigger for payouts
DROP TRIGGER IF EXISTS trg_viva_payouts_updated_at ON public.viva_payouts;
CREATE TRIGGER trg_viva_payouts_updated_at
  BEFORE UPDATE ON public.viva_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Settlement summary view (per user, live only)
-- Simple aggregation: paid volume, refunds, failed count, GlowPay margin, estimated settled.
CREATE OR REPLACE VIEW public.viva_settlement_summary
WITH (security_invoker = true) AS
SELECT
  p.user_id,
  COALESCE(SUM(CASE WHEN p.status IN ('paid','refunded','partially_refunded') THEN p.amount ELSE 0 END), 0)::numeric(14,2)        AS total_paid_volume,
  COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN p.amount ELSE 0 END), 0)::numeric(14,2)                                       AS total_refunds,
  COALESCE(SUM(CASE WHEN p.status IN ('failed','expired','cancelled') THEN 1 ELSE 0 END), 0)::int                                 AS failed_payment_count,
  COALESCE(SUM(CASE WHEN p.status IN ('paid','refunded','partially_refunded')
                    THEN COALESCE((p.metadata->>'glowpay_margin_cents')::numeric, 0) / 100 ELSE 0 END), 0)::numeric(14,2)         AS glowpay_margin_total,
  COALESCE(SUM(CASE WHEN p.status = 'paid'
                    THEN p.amount - (COALESCE((p.metadata->>'provider_fee_cents')::numeric, 0)
                                   + COALESCE((p.metadata->>'glowpay_margin_cents')::numeric, 0)) / 100
                    ELSE 0 END), 0)::numeric(14,2)                                                                                AS estimated_settled_total,
  COUNT(*)                                                                                                                        AS payment_count
FROM public.payments p
WHERE p.provider = 'viva' AND p.is_demo = false
GROUP BY p.user_id;
