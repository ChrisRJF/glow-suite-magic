
-- autopilot_runs
CREATE TABLE public.autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'simulated',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expected_revenue_cents integer NOT NULL DEFAULT 0,
  actual_revenue_cents integer NOT NULL DEFAULT 0,
  actions_count integer NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.autopilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view autopilot runs in active mode"
ON public.autopilot_runs FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Managers insert autopilot runs in active mode"
ON public.autopilot_runs FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Managers update autopilot runs in active mode"
ON public.autopilot_runs FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Owners delete autopilot runs in active mode"
ON public.autopilot_runs FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_role(auth.uid(), 'eigenaar'::app_role));

CREATE INDEX idx_autopilot_runs_user_started ON public.autopilot_runs(user_id, started_at DESC);

-- autopilot_decisions
CREATE TABLE public.autopilot_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.autopilot_runs(id) ON DELETE CASCADE,
  slot_date date NOT NULL,
  slot_time time,
  employee_id uuid,
  action text NOT NULL DEFAULT 'do_nothing',
  score numeric NOT NULL DEFAULT 0,
  fill_probability numeric NOT NULL DEFAULT 0,
  expected_revenue_cents integer NOT NULL DEFAULT 0,
  urgency_multiplier numeric NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'suggested',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.autopilot_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view autopilot decisions in active mode"
ON public.autopilot_decisions FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Managers insert autopilot decisions in active mode"
ON public.autopilot_decisions FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Managers update autopilot decisions in active mode"
ON public.autopilot_decisions FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Owners delete autopilot decisions in active mode"
ON public.autopilot_decisions FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_role(auth.uid(), 'eigenaar'::app_role));

CREATE INDEX idx_autopilot_decisions_run ON public.autopilot_decisions(run_id);
CREATE INDEX idx_autopilot_decisions_user_created ON public.autopilot_decisions(user_id, created_at DESC);

-- autopilot_action_logs
CREATE TABLE public.autopilot_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.autopilot_runs(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.autopilot_decisions(id) ON DELETE SET NULL,
  customer_id uuid,
  appointment_id uuid,
  action text NOT NULL,
  message text NOT NULL DEFAULT '',
  expected_revenue_cents integer NOT NULL DEFAULT 0,
  actual_revenue_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.autopilot_action_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view autopilot action logs in active mode"
ON public.autopilot_action_logs FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Managers insert autopilot action logs in active mode"
ON public.autopilot_action_logs FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Managers update autopilot action logs in active mode"
ON public.autopilot_action_logs FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role,'manager'::app_role,'admin'::app_role]));

CREATE POLICY "Owners delete autopilot action logs in active mode"
ON public.autopilot_action_logs FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_role(auth.uid(), 'eigenaar'::app_role));

CREATE INDEX idx_autopilot_action_logs_run ON public.autopilot_action_logs(run_id);
CREATE INDEX idx_autopilot_action_logs_user_created ON public.autopilot_action_logs(user_id, created_at DESC);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_decisions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_action_logs;
