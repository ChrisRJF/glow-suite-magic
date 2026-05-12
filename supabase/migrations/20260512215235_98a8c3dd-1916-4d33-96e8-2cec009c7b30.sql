ALTER TABLE public.viva_webhook_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'webhook';

CREATE INDEX IF NOT EXISTS viva_webhook_events_source_idx
  ON public.viva_webhook_events (user_id, source, created_at DESC);