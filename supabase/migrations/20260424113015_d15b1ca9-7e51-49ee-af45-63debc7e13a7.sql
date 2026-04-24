CREATE TABLE public.white_label_email_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  salon_slug TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  template_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.white_label_email_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_white_label_email_logs_user_created ON public.white_label_email_logs (user_id, created_at DESC);
CREATE INDEX idx_white_label_email_logs_template ON public.white_label_email_logs (template_key, created_at DESC);
CREATE INDEX idx_white_label_email_logs_status ON public.white_label_email_logs (status, created_at DESC);

CREATE POLICY "Users can view their own white label email logs"
ON public.white_label_email_logs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own white label email logs"
ON public.white_label_email_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own white label email logs"
ON public.white_label_email_logs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);
