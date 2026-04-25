-- Trial lifecycle email tracking
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS welcome_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS day3_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS day7_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS day10_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS day14_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_trial_ends
  ON public.subscriptions(status, trial_ends_at);

-- Enable scheduling extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;