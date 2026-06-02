ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS active_languages text[] NOT NULL DEFAULT ARRAY['nl','en','de','fr','es']::text[],
  ADD COLUMN IF NOT EXISTS allow_customer_language_switch boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_detect_language boolean NOT NULL DEFAULT true;