ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'mollie';

ALTER TABLE public.settings
  DROP CONSTRAINT IF EXISTS settings_payment_provider_check;

ALTER TABLE public.settings
  ADD CONSTRAINT settings_payment_provider_check
  CHECK (payment_provider IN ('mollie','viva'));