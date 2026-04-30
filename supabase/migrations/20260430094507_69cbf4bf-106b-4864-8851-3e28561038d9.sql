ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS send_no_show_followup boolean NOT NULL DEFAULT false;