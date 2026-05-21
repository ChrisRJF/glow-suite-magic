
CREATE TABLE IF NOT EXISTS public.pending_saas_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE,
  plan_slug text NOT NULL,
  email text,
  salon_name text,
  full_name text,
  user_id uuid,
  status text NOT NULL DEFAULT 'pending',
  activated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_saas_signups_order_code ON public.pending_saas_signups(order_code);
ALTER TABLE public.pending_saas_signups ENABLE ROW LEVEL SECURITY;
-- No public policies; only service role accesses via edge functions.
