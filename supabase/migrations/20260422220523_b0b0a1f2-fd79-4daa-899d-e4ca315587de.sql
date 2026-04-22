-- Harden public booking and payment status tracking

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_employee_start
ON public.appointments (user_id, employee_id, appointment_date)
WHERE employee_id IS NOT NULL AND status NOT IN ('geannuleerd', 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_unassigned_start
ON public.appointments (user_id, appointment_date)
WHERE employee_id IS NULL AND status NOT IN ('geannuleerd', 'cancelled');

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS webhook_received_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_mollie_payment_id_key
ON public.payments (mollie_payment_id)
WHERE mollie_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_booking_metadata
ON public.payments USING gin (metadata);