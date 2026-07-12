
ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_automation_runs_due
  ON public.automation_runs (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_automation_runs_retry
  ON public.automation_runs (status, next_retry_at)
  WHERE status = 'retry';
