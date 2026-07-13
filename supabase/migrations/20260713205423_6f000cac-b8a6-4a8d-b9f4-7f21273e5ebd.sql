
ALTER TABLE public.whatsapp_logs
  ADD COLUMN IF NOT EXISTS reminder_type text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booking_token text,
  ADD COLUMN IF NOT EXISTS confirmation_link text;

-- Cross-channel dedup: at most one canonical reminder per (appointment, type).
-- Only enforce when reminder_type is set AND status is sent — retries/failures may reuse the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_logs_reminder_dedup
  ON public.whatsapp_logs (appointment_id, reminder_type)
  WHERE reminder_type IS NOT NULL AND status = 'sent';

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_retry_queue
  ON public.whatsapp_logs (next_retry_at)
  WHERE status = 'failed' AND dead_letter = false AND next_retry_at IS NOT NULL;
