CREATE TABLE public.treatment_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'actief',
  planned_sessions integer,
  started_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_journeys TO authenticated;
GRANT ALL ON public.treatment_journeys TO service_role;

ALTER TABLE public.treatment_journeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant reads own journeys"
  ON public.treatment_journeys FOR SELECT TO authenticated
  USING (user_id = public.current_tenant_id() AND public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_dossier_status());

CREATE POLICY "Tenant creates journeys"
  ON public.treatment_journeys FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_tenant_id() AND public.can_view_dossier_content());

CREATE POLICY "Tenant updates journeys"
  ON public.treatment_journeys FOR UPDATE TO authenticated
  USING (user_id = public.current_tenant_id() AND public.can_view_dossier_content())
  WITH CHECK (user_id = public.current_tenant_id() AND public.can_view_dossier_content());

CREATE POLICY "Tenant deletes journeys"
  ON public.treatment_journeys FOR DELETE TO authenticated
  USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates());

CREATE INDEX idx_treatment_journeys_customer ON public.treatment_journeys (user_id, customer_id, started_on DESC);

CREATE TRIGGER update_treatment_journeys_updated_at
  BEFORE UPDATE ON public.treatment_journeys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS journey_id uuid REFERENCES public.treatment_journeys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journey_session_number integer;

CREATE INDEX IF NOT EXISTS idx_appointments_journey ON public.appointments (journey_id, appointment_date);

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS aftercare_text text;