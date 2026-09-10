ALTER TABLE public.form_requests
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_form_requests_reminder_pending
  ON public.form_requests (status, appointment_id) WHERE reminder_sent_at IS NULL;