-- Time entries
CREATE TABLE public.employee_time_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  date DATE NOT NULL,
  clock_in TIME,
  clock_out TIME,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view time entries in active mode"
ON public.employee_time_entries FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can insert time entries in active mode"
ON public.employee_time_entries FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can update time entries in active mode"
ON public.employee_time_entries FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Owners can delete time entries in active mode"
ON public.employee_time_entries FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role]));

CREATE TRIGGER trg_time_entries_updated
BEFORE UPDATE ON public.employee_time_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_time_entries_user_emp_date ON public.employee_time_entries(user_id, employee_id, date);

-- Payroll settings
CREATE TABLE public.employee_payroll_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0,
  commission_percentage_bps INTEGER NOT NULL DEFAULT 0,
  fixed_commission_cents INTEGER NOT NULL DEFAULT 0,
  tips_enabled BOOLEAN NOT NULL DEFAULT true,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, employee_id, is_demo)
);

ALTER TABLE public.employee_payroll_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view payroll settings in active mode"
ON public.employee_payroll_settings FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can insert payroll settings in active mode"
ON public.employee_payroll_settings FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can update payroll settings in active mode"
ON public.employee_payroll_settings FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Owners can delete payroll settings in active mode"
ON public.employee_payroll_settings FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_role(auth.uid(), 'eigenaar'::app_role));

CREATE TRIGGER trg_payroll_settings_updated
BEFORE UPDATE ON public.employee_payroll_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Adjustments
CREATE TABLE public.employee_payroll_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  period_month TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bonus',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_payroll_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view payroll adjustments in active mode"
ON public.employee_payroll_adjustments FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can insert payroll adjustments in active mode"
ON public.employee_payroll_adjustments FOR INSERT
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers can update payroll adjustments in active mode"
ON public.employee_payroll_adjustments FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]))
WITH CHECK (auth.uid() = user_id AND is_demo = current_account_is_demo() AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

CREATE POLICY "Owners can delete payroll adjustments in active mode"
ON public.employee_payroll_adjustments FOR DELETE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role]));

CREATE TRIGGER trg_payroll_adjustments_updated
BEFORE UPDATE ON public.employee_payroll_adjustments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_payroll_adj_user_emp_period ON public.employee_payroll_adjustments(user_id, employee_id, period_month);