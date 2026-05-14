CREATE TABLE IF NOT EXISTS public.viva_terminals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  terminal_id text NOT NULL,
  terminal_name text NOT NULL,
  location_name text,
  status text NOT NULL DEFAULT 'active',
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, is_demo, terminal_id)
);

CREATE INDEX IF NOT EXISTS idx_viva_terminals_user_mode ON public.viva_terminals (user_id, is_demo, status);

ALTER TABLE public.viva_terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view terminals in active mode"
  ON public.viva_terminals FOR SELECT
  USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()));

CREATE POLICY "Finance roles can insert terminals in active mode"
  ON public.viva_terminals FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.can_view_finance(auth.uid()));

CREATE POLICY "Finance roles can update terminals in active mode"
  ON public.viva_terminals FOR UPDATE
  USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.can_view_finance(auth.uid()));

CREATE POLICY "Owners can delete terminals in active mode"
  ON public.viva_terminals FOR DELETE
  USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_role(auth.uid(), 'eigenaar'::public.app_role));

CREATE TRIGGER update_viva_terminals_updated_at
  BEFORE UPDATE ON public.viva_terminals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();