
-- Add new settings columns
ALTER TABLE public.settings 
  ADD COLUMN IF NOT EXISTS opening_hours jsonb DEFAULT '{"ma":{"open":"09:00","close":"18:00","enabled":true},"di":{"open":"09:00","close":"18:00","enabled":true},"wo":{"open":"09:00","close":"18:00","enabled":true},"do":{"open":"09:00","close":"18:00","enabled":true},"vr":{"open":"09:00","close":"18:00","enabled":true},"za":{"open":"09:00","close":"17:00","enabled":true},"zo":{"open":"09:00","close":"17:00","enabled":false}}'::jsonb,
  ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_bookings_simultaneous integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS group_bookings_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_block_noshow integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS google_calendar_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS instagram_booking_enabled boolean DEFAULT false;

-- Create user_roles table
CREATE TYPE public.app_role AS ENUM ('eigenaar', 'admin', 'medewerker');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Owners can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'eigenaar'));

-- Create sub_appointments table for group bookings
CREATE TABLE public.sub_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  person_name text NOT NULL,
  service_id uuid REFERENCES public.services(id),
  price numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'gepland',
  notes text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.sub_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sub_appointments" ON public.sub_appointments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sub_appointments" ON public.sub_appointments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sub_appointments" ON public.sub_appointments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sub_appointments" ON public.sub_appointments
  FOR DELETE USING (auth.uid() = user_id);
