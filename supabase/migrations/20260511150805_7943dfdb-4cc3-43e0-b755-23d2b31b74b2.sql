CREATE TABLE IF NOT EXISTS public.viva_webhook_debug_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  method text,
  headers jsonb,
  query jsonb,
  body_preview text,
  user_agent text,
  source_ip text
);

CREATE INDEX IF NOT EXISTS viva_webhook_debug_logs_created_at_idx
  ON public.viva_webhook_debug_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS viva_webhook_debug_logs_method_created_at_idx
  ON public.viva_webhook_debug_logs (method, created_at DESC);

ALTER TABLE public.viva_webhook_debug_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins can view viva webhook debug logs" ON public.viva_webhook_debug_logs;
CREATE POLICY "Finance admins can view viva webhook debug logs"
  ON public.viva_webhook_debug_logs
  FOR SELECT
  TO authenticated
  USING (public.can_view_finance(auth.uid()));