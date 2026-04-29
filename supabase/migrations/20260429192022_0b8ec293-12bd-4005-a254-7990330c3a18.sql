-- WhatsApp templates table
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  template_type TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, template_type)
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own whatsapp templates"
ON public.whatsapp_templates FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own whatsapp templates"
ON public.whatsapp_templates FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own whatsapp templates"
ON public.whatsapp_templates FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own whatsapp templates"
ON public.whatsapp_templates FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_whatsapp_templates_updated_at
BEFORE UPDATE ON public.whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Dedup: prevent duplicate WhatsApp sends per appointment_id + kind (only when both present and status is sent)
-- Use a partial unique index so failed retries don't block resends.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_logs_dedup_sent_idx
ON public.whatsapp_logs (appointment_id, kind)
WHERE appointment_id IS NOT NULL AND status = 'sent';

-- Scheduler runs tracking
CREATE TABLE IF NOT EXISTS public.whatsapp_scheduler_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  checked INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.whatsapp_scheduler_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view scheduler runs"
ON public.whatsapp_scheduler_runs FOR SELECT
TO authenticated
USING (true);
