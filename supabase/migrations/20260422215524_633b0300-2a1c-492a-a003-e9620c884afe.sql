-- Public booking readiness: salon slug, booking metadata, and user onboarding triggers

-- Add public salon slug and booking copy/config to settings
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS public_slug text,
ADD COLUMN IF NOT EXISTS show_prices_online boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS public_employees_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS cancellation_notice text DEFAULT 'Annuleer of verplaats je afspraak minimaal 24 uur van tevoren.';

-- Ensure every settings row can have a stable public slug
UPDATE public.settings
SET public_slug = lower(regexp_replace(coalesce(nullif(salon_name, ''), 'salon') || '-' || left(user_id::text, 8), '[^a-z0-9]+', '-', 'g'))
WHERE public_slug IS NULL OR public_slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS settings_public_slug_key ON public.settings (public_slug) WHERE public_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settings_public_slug ON public.settings (public_slug);
CREATE INDEX IF NOT EXISTS idx_services_public_booking ON public.services (user_id, is_active, is_online_bookable, is_internal_only);
CREATE INDEX IF NOT EXISTS idx_customers_user_email ON public.customers (user_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_appointments_availability ON public.appointments (user_id, appointment_date, status);

-- Add customer consent fields used by public booking
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS marketing_consent boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS privacy_consent boolean DEFAULT false;

-- Add production online-booking metadata to appointments
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS employee_id text,
ADD COLUMN IF NOT EXISTS start_time time,
ADD COLUMN IF NOT EXISTS end_time time,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS booking_token uuid DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS booking_reference text,
ADD COLUMN IF NOT EXISTS booking_group_id uuid,
ADD COLUMN IF NOT EXISTS payment_type text;

-- Backfill existing appointment timing/reference values safely
UPDATE public.appointments
SET start_time = appointment_date::time
WHERE start_time IS NULL;

UPDATE public.appointments
SET end_time = (appointment_date + interval '30 minutes')::time
WHERE end_time IS NULL;

UPDATE public.appointments
SET booking_reference = 'GS-' || upper(left(replace(id::text, '-', ''), 8))
WHERE booking_reference IS NULL OR booking_reference = '';

CREATE UNIQUE INDEX IF NOT EXISTS appointments_booking_token_key ON public.appointments (booking_token);
CREATE INDEX IF NOT EXISTS idx_appointments_booking_group_id ON public.appointments (booking_group_id);
CREATE INDEX IF NOT EXISTS idx_appointments_booking_reference ON public.appointments (booking_reference);

-- Keep booking references populated for new online bookings
CREATE OR REPLACE FUNCTION public.set_booking_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_reference IS NULL OR NEW.booking_reference = '' THEN
    NEW.booking_reference := 'GS-' || upper(left(replace(NEW.id::text, '-', ''), 8));
  END IF;
  IF NEW.start_time IS NULL THEN
    NEW.start_time := NEW.appointment_date::time;
  END IF;
  IF NEW.end_time IS NULL THEN
    NEW.end_time := (NEW.appointment_date + interval '30 minutes')::time;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_booking_reference_before_insert ON public.appointments;
CREATE TRIGGER set_booking_reference_before_insert
BEFORE INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.set_booking_reference();

-- Create missing auth onboarding triggers that call existing functions
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_role();