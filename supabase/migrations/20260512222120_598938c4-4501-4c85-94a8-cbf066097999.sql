-- Admin notifications table (in-app alerts for salon owners/admins)
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  link text,
  acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_notifications_user_idx
  ON public.admin_notifications (user_id, acknowledged_at, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_type_idx
  ON public.admin_notifications (type, created_at DESC);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own admin notifications" ON public.admin_notifications;
CREATE POLICY "Users view own admin notifications"
  ON public.admin_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users update own admin notifications" ON public.admin_notifications;
CREATE POLICY "Users update own admin notifications"
  ON public.admin_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Dead-letter queue for unrecoverable Viva events
CREATE TABLE IF NOT EXISTS public.viva_dead_letter_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  source text NOT NULL DEFAULT 'reconciliation',
  event_type text,
  order_code text,
  transaction_id text,
  payment_id uuid,
  retry_count integer NOT NULL DEFAULT 0,
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS viva_dlq_user_idx
  ON public.viva_dead_letter_queue (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS viva_dlq_unresolved_idx
  ON public.viva_dead_letter_queue (resolved_at, created_at DESC);

ALTER TABLE public.viva_dead_letter_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own viva dlq" ON public.viva_dead_letter_queue;
CREATE POLICY "Users view own viva dlq"
  ON public.viva_dead_letter_queue FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);
