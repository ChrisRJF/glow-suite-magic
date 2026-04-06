
ALTER TABLE public.payments 
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'mollie',
  ADD COLUMN IF NOT EXISTS checkout_reference text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
