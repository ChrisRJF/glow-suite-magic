
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS confirmation_responded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_appointments_booking_token
  ON public.appointments (booking_token)
  WHERE booking_token IS NOT NULL;
