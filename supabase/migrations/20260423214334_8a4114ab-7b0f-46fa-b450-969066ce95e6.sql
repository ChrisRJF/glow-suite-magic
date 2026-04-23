ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS delay_value integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_unit text NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS message_templates jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS provider_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS run_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_generated numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  automation_rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  customer_id uuid,
  appointment_id uuid,
  membership_id uuid,
  payment_id uuid,
  channel text NOT NULL DEFAULT 'email',
  recipient text,
  status text NOT NULL DEFAULT 'scheduled',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  revenue_attributed numeric NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  automation_rule_id uuid REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  automation_run_id uuid REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  customer_id uuid,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'info',
  message text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revenue_attributed numeric NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_message_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  preferred_channel text NOT NULL DEFAULT 'email',
  email_opt_out boolean NOT NULL DEFAULT false,
  sms_opt_out boolean NOT NULL DEFAULT false,
  whatsapp_opt_out boolean NOT NULL DEFAULT false,
  language text NOT NULL DEFAULT 'nl',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  tag text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, customer_id, tag)
);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_message_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view automation runs in active mode" ON public.automation_runs;
CREATE POLICY "Users can view automation runs in active mode"
ON public.automation_runs FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Managers can manage automation runs in active mode" ON public.automation_runs;
CREATE POLICY "Managers can manage automation runs in active mode"
ON public.automation_runs FOR ALL
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

DROP POLICY IF EXISTS "Users can view automation logs in active mode" ON public.automation_logs;
CREATE POLICY "Users can view automation logs in active mode"
ON public.automation_logs FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Managers can create automation logs in active mode" ON public.automation_logs;
CREATE POLICY "Managers can create automation logs in active mode"
ON public.automation_logs FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

DROP POLICY IF EXISTS "Users can manage message preferences in active mode" ON public.customer_message_preferences;
CREATE POLICY "Users can manage message preferences in active mode"
ON public.customer_message_preferences FOR ALL
USING (user_row_matches_active_mode(user_id, is_demo))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo());

DROP POLICY IF EXISTS "Users can manage customer tags in active mode" ON public.customer_tags;
CREATE POLICY "Users can manage customer tags in active mode"
ON public.customer_tags FOR ALL
USING (user_row_matches_active_mode(user_id, is_demo))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo());

DROP POLICY IF EXISTS "Users can delete automation rules in active mode" ON public.automation_rules;
DROP POLICY IF EXISTS "Users can insert automation rules in active mode" ON public.automation_rules;
DROP POLICY IF EXISTS "Users can update automation rules in active mode" ON public.automation_rules;
DROP POLICY IF EXISTS "Users can view automation rules in active mode" ON public.automation_rules;

CREATE POLICY "Users can view automation rules in active mode"
ON public.automation_rules FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Managers can insert automation rules in active mode"
ON public.automation_rules FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can update automation rules in active mode"
ON public.automation_rules FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Owners can delete automation rules in active mode"
ON public.automation_rules FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_role(auth.uid(), 'eigenaar'::app_role));

CREATE INDEX IF NOT EXISTS idx_automation_rules_user_active ON public.automation_rules(user_id, is_demo, is_active);
CREATE INDEX IF NOT EXISTS idx_automation_runs_due ON public.automation_runs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON public.automation_runs(automation_rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_rule ON public.automation_logs(automation_rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_preferences_customer ON public.customer_message_preferences(user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON public.customer_tags(user_id, customer_id);

CREATE TRIGGER update_automation_runs_updated_at
BEFORE UPDATE ON public.automation_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_message_preferences_updated_at
BEFORE UPDATE ON public.customer_message_preferences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();