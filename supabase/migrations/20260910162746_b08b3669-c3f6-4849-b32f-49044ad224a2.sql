-- ============ P0b: treatment records, clinical media, dossier status ============

CREATE TABLE public.treatment_record_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  schema jsonb NOT NULL DEFAULT '{"fields": []}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_record_templates TO authenticated;
GRANT ALL ON public.treatment_record_templates TO service_role;
ALTER TABLE public.treatment_record_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dossier staff can view treatment templates" ON public.treatment_record_templates
  FOR SELECT TO authenticated
  USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_status());
CREATE POLICY "Managers can insert treatment templates" ON public.treatment_record_templates
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates());
CREATE POLICY "Managers can update treatment templates" ON public.treatment_record_templates
  FOR UPDATE TO authenticated
  USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates())
  WITH CHECK (user_id = public.current_tenant_id() AND public.can_manage_form_templates());
CREATE POLICY "Managers can delete treatment templates" ON public.treatment_record_templates
  FOR DELETE TO authenticated
  USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates());
CREATE TRIGGER treatment_record_templates_updated_at BEFORE UPDATE ON public.treatment_record_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_trt_templates_service ON public.treatment_record_templates(user_id, service_id, is_active);

CREATE TABLE public.treatment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  employee_id uuid,
  service_id uuid,
  template_id uuid REFERENCES public.treatment_record_templates(id) ON DELETE RESTRICT,
  template_version integer NOT NULL DEFAULT 1,
  template_snapshot jsonb NOT NULL DEFAULT '{"fields": []}'::jsonb,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  locked_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_records TO authenticated;
GRANT ALL ON public.treatment_records TO service_role;
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dossier content staff can view treatment records" ON public.treatment_records
  FOR SELECT TO authenticated
  USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());
CREATE POLICY "Dossier content staff can insert treatment records" ON public.treatment_records
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());
CREATE POLICY "Dossier content staff can update open treatment records" ON public.treatment_records
  FOR UPDATE TO authenticated
  USING (user_id = public.current_tenant_id() AND public.can_view_dossier_content() AND locked_at IS NULL)
  WITH CHECK (user_id = public.current_tenant_id() AND public.can_view_dossier_content());
CREATE TRIGGER treatment_records_updated_at BEFORE UPDATE ON public.treatment_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_treatment_records_customer ON public.treatment_records(user_id, customer_id, created_at DESC);
CREATE INDEX idx_treatment_records_appointment ON public.treatment_records(user_id, appointment_id);
CREATE INDEX idx_treatment_records_service ON public.treatment_records(user_id, service_id);
CREATE UNIQUE INDEX uq_treatment_record_per_appointment_template
  ON public.treatment_records(user_id, appointment_id, template_id)
  WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.block_locked_treatment_record_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Completed treatment records are immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Completed treatment records are immutable';
  END IF;
  IF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER treatment_records_immutable BEFORE UPDATE OR DELETE ON public.treatment_records
  FOR EACH ROW EXECUTE FUNCTION public.block_locked_treatment_record_change();

CREATE TABLE public.clinical_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  treatment_record_id uuid REFERENCES public.treatment_records(id) ON DELETE SET NULL,
  employee_id uuid,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('before','after','control','other')),
  storage_path text NOT NULL UNIQUE,
  caption text,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.clinical_media TO authenticated;
GRANT ALL ON public.clinical_media TO service_role;
ALTER TABLE public.clinical_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dossier content staff can view clinical media" ON public.clinical_media
  FOR SELECT TO authenticated
  USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());
CREATE POLICY "Dossier content staff can insert clinical media" ON public.clinical_media
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());
CREATE POLICY "Managers can delete clinical media" ON public.clinical_media
  FOR DELETE TO authenticated
  USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates());
CREATE INDEX idx_clinical_media_customer ON public.clinical_media(user_id, customer_id, created_at DESC);
CREATE INDEX idx_clinical_media_appointment ON public.clinical_media(user_id, appointment_id);
CREATE INDEX idx_clinical_media_record ON public.clinical_media(user_id, treatment_record_id);

-- ============ dossier readiness, batched to avoid N+1 in the agenda ============
CREATE OR REPLACE FUNCTION public.appointment_dossier_status(_appointment_ids uuid[])
RETURNS TABLE(appointment_id uuid, status text, reasons jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF _tenant IS NULL OR public.can_view_dossier_status() IS NOT TRUE THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH appt AS (
    SELECT a.id, a.customer_id, a.service_id, a.appointment_date
    FROM public.appointments a
    WHERE a.user_id = _tenant
      AND COALESCE(a.is_demo, false) = public.current_tenant_is_demo()
      AND a.id = ANY(_appointment_ids)
  ),
  required_forms AS (
    SELECT ap.id AS appt_id, ft.id AS template_id, ft.title,
           EXISTS (
             SELECT 1 FROM public.form_requests fr
             WHERE fr.user_id = _tenant
               AND fr.customer_id = ap.customer_id
               AND fr.template_id = ft.id
               AND fr.status = 'completed'
           ) AS done
    FROM appt ap
    JOIN public.service_form_requirements sfr
      ON sfr.user_id = _tenant AND sfr.service_id = ap.service_id
    JOIN public.form_templates ft
      ON ft.id = sfr.template_id AND ft.user_id = _tenant AND ft.is_active
  ),
  record_need AS (
    SELECT ap.id AS appt_id,
           EXISTS (
             SELECT 1 FROM public.treatment_record_templates trt
             WHERE trt.user_id = _tenant AND trt.is_active AND trt.service_id = ap.service_id
           ) AS required,
           (
             SELECT tr.status FROM public.treatment_records tr
             WHERE tr.user_id = _tenant AND tr.appointment_id = ap.id
             ORDER BY tr.created_at DESC LIMIT 1
           ) AS record_status,
           ap.appointment_date < now() AS is_past
    FROM appt ap
  ),
  media AS (
    SELECT ap.id AS appt_id,
           count(*) FILTER (WHERE cm.category = 'before') AS before_count,
           count(*) FILTER (WHERE cm.category = 'after') AS after_count
    FROM appt ap
    LEFT JOIN public.clinical_media cm ON cm.user_id = _tenant AND cm.appointment_id = ap.id
    GROUP BY ap.id
  )
  SELECT ap.id,
    CASE
      WHEN EXISTS (SELECT 1 FROM required_forms rf WHERE rf.appt_id = ap.id AND NOT rf.done) THEN 'actie_nodig'
      WHEN rn.required AND rn.is_past AND COALESCE(rn.record_status, 'missing') <> 'completed' THEN 'af_te_ronden'
      ELSE 'compleet'
    END,
    jsonb_build_object(
      'forms', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('title', rf.title, 'ok', rf.done) ORDER BY rf.title)
        FROM required_forms rf WHERE rf.appt_id = ap.id
      ), '[]'::jsonb),
      'treatment_record_required', rn.required,
      'treatment_record_status', COALESCE(rn.record_status, 'missing'),
      'before_photos', COALESCE(m.before_count, 0),
      'after_photos', COALESCE(m.after_count, 0)
    )
  FROM appt ap
  JOIN record_need rn ON rn.appt_id = ap.id
  LEFT JOIN media m ON m.appt_id = ap.id;
END;
$$;

-- ============ private clinical storage policies ============
CREATE POLICY "Dossier staff read clinical files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clinical-files'
    AND public.can_view_dossier_content()
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );
CREATE POLICY "Dossier staff upload clinical files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clinical-files'
    AND public.can_view_dossier_content()
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );
CREATE POLICY "Managers delete clinical files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'clinical-files'
    AND public.can_manage_form_templates()
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );