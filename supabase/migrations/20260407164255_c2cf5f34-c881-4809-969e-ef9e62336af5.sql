
-- Add booking visibility fields to services
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS is_online_bookable boolean DEFAULT true;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS is_internal_only boolean DEFAULT false;

-- Add 'financieel' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'financieel';

-- Add assigned_employee field to sub_appointments for group booking
ALTER TABLE public.sub_appointments ADD COLUMN IF NOT EXISTS assigned_employee_id uuid DEFAULT NULL;
ALTER TABLE public.sub_appointments ADD COLUMN IF NOT EXISTS assignment_mode text DEFAULT 'manual';
