ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz,
  ADD COLUMN IF NOT EXISTS payment_failure_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_subscriptions_past_due_since
  ON public.subscriptions(past_due_since)
  WHERE status = 'past_due';