
-- Viva activation/diagnostic fields on settings (per-salon)
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS viva_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS viva_merchant_id text,
  ADD COLUMN IF NOT EXISTS viva_source_code text,
  ADD COLUMN IF NOT EXISTS viva_client_id text,
  ADD COLUMN IF NOT EXISTS viva_live_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viva_demo_enabled boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_viva_status_check') THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_viva_status_check
      CHECK (viva_status IN ('not_started','requested','pending_viva_contact','approved','active','rejected','needs_info'));
  END IF;
END $$;

-- Webhook event ledger (source of truth for inbound Viva events)
CREATE TABLE IF NOT EXISTS public.viva_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  event_id text,
  event_type text,
  event_type_id integer,
  order_code text,
  transaction_id text,
  payment_id uuid,
  status text,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  error text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS viva_webhook_events_event_id_uidx
  ON public.viva_webhook_events (event_id) WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS viva_webhook_events_composite_uidx
  ON public.viva_webhook_events (order_code, transaction_id, status, event_type)
  WHERE event_id IS NULL AND order_code IS NOT NULL AND transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS viva_webhook_events_user_idx ON public.viva_webhook_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS viva_webhook_events_payment_idx ON public.viva_webhook_events (payment_id);

ALTER TABLE public.viva_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own viva webhook events" ON public.viva_webhook_events;
CREATE POLICY "Users can view their own viva webhook events"
  ON public.viva_webhook_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
