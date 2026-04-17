ALTER TABLE public.settings 
ADD COLUMN IF NOT EXISTS whitelabel_branding jsonb DEFAULT NULL;