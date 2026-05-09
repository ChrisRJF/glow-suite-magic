ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS accepted_glowsuite_terms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_salon_terms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz NULL;