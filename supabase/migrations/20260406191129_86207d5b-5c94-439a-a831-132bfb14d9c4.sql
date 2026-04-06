
CREATE TABLE public.automation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  trigger_type TEXT NOT NULL,
  action_type TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}'::jsonb,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own automation_rules" ON public.automation_rules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own automation_rules" ON public.automation_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own automation_rules" ON public.automation_rules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own automation_rules" ON public.automation_rules FOR DELETE USING (auth.uid() = user_id);
