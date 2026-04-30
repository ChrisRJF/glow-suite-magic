-- 1. Employees table
CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7B61FF',
  photo_url TEXT,
  email TEXT,
  phone TEXT,
  working_days INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  break_start TIME,
  break_end TIME,
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_employees_user_id ON public.employees(user_id, is_demo);
CREATE INDEX idx_employees_active ON public.employees(user_id, is_active) WHERE is_active = true;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view employees in active mode"
ON public.employees FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Managers can insert employees in active mode"
ON public.employees FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'receptie'::public.app_role])
);

CREATE POLICY "Managers can update employees in active mode"
ON public.employees FOR UPDATE
USING (
  public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'receptie'::public.app_role])
)
WITH CHECK (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role, 'receptie'::public.app_role])
);

CREATE POLICY "Owners can delete employees in active mode"
ON public.employees FOR DELETE
USING (
  public.user_row_matches_active_mode(user_id, is_demo)
  AND public.has_any_role(auth.uid(), ARRAY['eigenaar'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role])
);

CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Appointment ↔ Employees join table
CREATE TABLE public.appointment_employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, employee_id)
);

CREATE INDEX idx_appointment_employees_appt ON public.appointment_employees(appointment_id);
CREATE INDEX idx_appointment_employees_emp ON public.appointment_employees(employee_id);
CREATE INDEX idx_appointment_employees_user ON public.appointment_employees(user_id, is_demo);

ALTER TABLE public.appointment_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view appointment_employees in active mode"
ON public.appointment_employees FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Users can insert appointment_employees in active mode"
ON public.appointment_employees FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
);

CREATE POLICY "Users can update appointment_employees in active mode"
ON public.appointment_employees FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo))
WITH CHECK (
  auth.uid() = user_id
  AND is_demo = public.current_account_is_demo()
);

CREATE POLICY "Users can delete appointment_employees in active mode"
ON public.appointment_employees FOR DELETE
USING (public.user_row_matches_active_mode(user_id, is_demo));

-- 3. Storage bucket for employee photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-photos', 'employee-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read
CREATE POLICY "Employee photos are publicly viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'employee-photos');

-- Only owner uploads in their own folder ({user_id}/...)
CREATE POLICY "Users can upload their own employee photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'employee-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own employee photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'employee-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own employee photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'employee-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);