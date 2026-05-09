
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS breaks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'werkzaam',
  ADD COLUMN IF NOT EXISTS status_note TEXT,
  ADD COLUMN IF NOT EXISTS status_from DATE,
  ADD COLUMN IF NOT EXISTS status_until DATE;

CREATE TABLE IF NOT EXISTS public.employee_availability_exceptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  start_time TIME,
  end_time TIME,
  days_of_week INTEGER[],
  note TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eae_user_id ON public.employee_availability_exceptions(user_id, is_demo);
CREATE INDEX IF NOT EXISTS idx_eae_emp_dates ON public.employee_availability_exceptions(employee_id, start_date, end_date);

ALTER TABLE public.employee_availability_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View exceptions in active mode"
ON public.employee_availability_exceptions FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Managers can insert exceptions in active mode"
ON public.employee_availability_exceptions FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'receptie'::public.app_role])
);

CREATE POLICY "Managers can update exceptions in active mode"
ON public.employee_availability_exceptions FOR UPDATE
USING (
  public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'receptie'::public.app_role])
)
WITH CHECK (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
);

CREATE POLICY "Managers can delete exceptions in active mode"
ON public.employee_availability_exceptions FOR DELETE
USING (
  public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'receptie'::public.app_role])
);

CREATE TRIGGER trg_eae_updated_at
BEFORE UPDATE ON public.employee_availability_exceptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
