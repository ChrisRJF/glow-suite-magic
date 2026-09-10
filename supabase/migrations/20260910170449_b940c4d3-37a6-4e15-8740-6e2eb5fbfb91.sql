-- ============ 1. Validity policy on form requirements ============
ALTER TABLE public.service_form_requirements
  ADD COLUMN IF NOT EXISTS validity_mode text NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS validity_months integer,
  ADD COLUMN IF NOT EXISTS reissue_on_new_version boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_send boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_hours integer NOT NULL DEFAULT 24;

ALTER TABLE public.service_form_requirements
  DROP CONSTRAINT IF EXISTS service_form_requirements_validity_mode_check;
ALTER TABLE public.service_form_requirements
  ADD CONSTRAINT service_form_requirements_validity_mode_check
  CHECK (validity_mode IN ('once','every_appointment','months','new_version'));

ALTER TABLE public.service_form_requirements
  DROP CONSTRAINT IF EXISTS service_form_requirements_reminder_hours_check;
ALTER TABLE public.service_form_requirements
  ADD CONSTRAINT service_form_requirements_reminder_hours_check
  CHECK (reminder_hours IN (0, 24, 48));

CREATE POLICY "Managers can update requirements"
ON public.service_form_requirements FOR UPDATE TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates())
WITH CHECK (user_id = public.current_tenant_id() AND public.can_manage_form_templates());

-- ============ 2. Manual re-issue markers ============
CREATE TABLE IF NOT EXISTS public.form_reissue_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  required_after timestamptz NOT NULL DEFAULT now(),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, customer_id, template_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_reissue_flags TO authenticated;
GRANT ALL ON public.form_reissue_flags TO service_role;
ALTER TABLE public.form_reissue_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff can view reissue flags"
ON public.form_reissue_flags FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_status());

CREATE POLICY "Dossier staff can create reissue flags"
ON public.form_reissue_flags FOR INSERT TO authenticated
WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_send_customer_form());

CREATE POLICY "Dossier staff can update reissue flags"
ON public.form_reissue_flags FOR UPDATE TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_send_customer_form())
WITH CHECK (user_id = public.current_tenant_id() AND public.can_send_customer_form());

CREATE POLICY "Managers can delete reissue flags"
ON public.form_reissue_flags FOR DELETE TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates());

-- ============ 3. Customer alerts ============
CREATE TABLE IF NOT EXISTS public.customer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid,
  label text NOT NULL,
  review_status text NOT NULL DEFAULT 'unreviewed',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_alerts_source_type_check CHECK (source_type IN ('manual','form_answer')),
  CONSTRAINT customer_alerts_review_status_check CHECK (review_status IN ('unreviewed','reviewed','action_needed'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_alerts TO authenticated;
GRANT ALL ON public.customer_alerts TO service_role;
ALTER TABLE public.customer_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier content staff can view alerts"
ON public.customer_alerts FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());

CREATE POLICY "Dossier content staff can create alerts"
ON public.customer_alerts FOR INSERT TO authenticated
WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());

CREATE POLICY "Dossier content staff can review alerts"
ON public.customer_alerts FOR UPDATE TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_view_dossier_content())
WITH CHECK (user_id = public.current_tenant_id() AND public.can_view_dossier_content());

CREATE POLICY "Managers can delete alerts"
ON public.customer_alerts FOR DELETE TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_manage_form_templates());

CREATE TRIGGER customer_alerts_updated_at
BEFORE UPDATE ON public.customer_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 4. Booking automation queue ============
CREATE TABLE IF NOT EXISTS public.dossier_automation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  event text NOT NULL DEFAULT 'appointment_created',
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, event)
);

GRANT SELECT ON public.dossier_automation_queue TO authenticated;
GRANT ALL ON public.dossier_automation_queue TO service_role;
ALTER TABLE public.dossier_automation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff can view automation queue"
ON public.dossier_automation_queue FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_view_dossier_status());

CREATE INDEX IF NOT EXISTS idx_dossier_queue_pending
  ON public.dossier_automation_queue (processed_at, created_at) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.enqueue_dossier_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NULL OR NEW.service_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.dossier_automation_queue (user_id, is_demo, appointment_id, event)
  VALUES (NEW.user_id, COALESCE(NEW.is_demo, false), NEW.id, 'appointment_created')
  ON CONFLICT (appointment_id, event) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_dossier_automation ON public.appointments;
CREATE TRIGGER trg_enqueue_dossier_automation
AFTER INSERT ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.enqueue_dossier_automation();

-- ============ 5. Central required-forms logic ============
CREATE OR REPLACE FUNCTION public.determine_required_forms_for_appointment(_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _appt record;
  _result jsonb;
BEGIN
  SELECT a.id, a.user_id, a.customer_id, a.service_id, a.appointment_date,
         COALESCE(a.is_demo, false) AS is_demo, lower(COALESCE(a.status,'')) AS status
    INTO _appt
  FROM public.appointments a WHERE a.id = _appointment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'appointment_not_found');
  END IF;

  -- Staff calls must be inside their own tenant. Service role (no JWT) is trusted.
  IF auth.uid() IS NOT NULL THEN
    IF public.current_tenant_id() IS DISTINCT FROM _appt.user_id
       OR public.can_view_dossier_status() IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  WITH req AS (
    SELECT sfr.template_id, sfr.validity_mode, sfr.validity_months,
           sfr.reissue_on_new_version, sfr.auto_send, sfr.reminder_hours,
           ft.title, ft.current_version
    FROM public.service_form_requirements sfr
    JOIN public.form_templates ft
      ON ft.id = sfr.template_id AND ft.user_id = sfr.user_id AND ft.is_active AND ft.current_version > 0
    WHERE sfr.user_id = _appt.user_id
      AND sfr.service_id = _appt.service_id
      AND sfr.is_demo = _appt.is_demo
  ),
  latest AS (
    SELECT r.template_id,
           (SELECT to_jsonb(x) FROM (
              SELECT fs.id, fs.submitted_at, fs.appointment_id,
                     ftv.version AS version
              FROM public.form_submissions fs
              JOIN public.form_template_versions ftv ON ftv.id = fs.template_version_id
              WHERE fs.user_id = _appt.user_id
                AND fs.customer_id = _appt.customer_id
                AND fs.template_id = r.template_id
              ORDER BY fs.submitted_at DESC
              LIMIT 1
            ) x) AS sub,
           (SELECT count(*) FROM public.form_submissions fs2
             WHERE fs2.user_id = _appt.user_id AND fs2.customer_id = _appt.customer_id
               AND fs2.template_id = r.template_id AND fs2.appointment_id = _appt.id) AS sub_this_appt,
           (SELECT frf.required_after FROM public.form_reissue_flags frf
             WHERE frf.user_id = _appt.user_id AND frf.customer_id = _appt.customer_id
               AND frf.template_id = r.template_id) AS required_after,
           (SELECT to_jsonb(y) FROM (
              SELECT fr.id, fr.status, fr.expires_at, fr.appointment_id, fr.sent_at
              FROM public.form_requests fr
              WHERE fr.user_id = _appt.user_id
                AND fr.customer_id = _appt.customer_id
                AND fr.template_id = r.template_id
                AND fr.status IN ('draft','sent','opened')
                AND fr.expires_at > now()
                AND (fr.appointment_id = _appt.id OR fr.appointment_id IS NULL)
              ORDER BY fr.created_at DESC
              LIMIT 1
            ) y) AS open_request
    FROM req r
  ),
  judged AS (
    SELECT r.template_id, r.title, r.validity_mode, r.validity_months, r.auto_send,
           r.reminder_hours, r.current_version, l.sub, l.open_request, l.required_after,
           CASE
             WHEN l.sub IS NULL THEN 'missing'
             WHEN l.required_after IS NOT NULL
                  AND (l.sub->>'submitted_at')::timestamptz <= l.required_after THEN 'reissue_required'
             WHEN r.validity_mode = 'every_appointment' AND l.sub_this_appt = 0 THEN 'missing'
             WHEN (r.validity_mode = 'new_version' OR r.reissue_on_new_version)
                  AND COALESCE((l.sub->>'version')::int, 0) < r.current_version THEN 'version_outdated'
             WHEN r.validity_mode = 'months'
                  AND (l.sub->>'submitted_at')::timestamptz
                      + make_interval(months => GREATEST(1, COALESCE(r.validity_months, 12))) < now() THEN 'expired'
             ELSE 'valid'
           END AS state
    FROM req r JOIN latest l ON l.template_id = r.template_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'appointment_id', _appt.id,
    'user_id', _appt.user_id,
    'customer_id', _appt.customer_id,
    'is_demo', _appt.is_demo,
    'appointment_date', _appt.appointment_date,
    'status', _appt.status,
    'required', COALESCE(jsonb_agg(jsonb_build_object(
        'template_id', j.template_id,
        'title', j.title,
        'state', j.state,
        'validity_mode', j.validity_mode,
        'validity_months', j.validity_months,
        'auto_send', j.auto_send,
        'reminder_hours', j.reminder_hours,
        'valid_until', CASE
            WHEN j.state = 'valid' AND j.validity_mode = 'months' AND j.sub IS NOT NULL
              THEN to_jsonb((j.sub->>'submitted_at')::timestamptz
                   + make_interval(months => GREATEST(1, COALESCE(j.validity_months, 12))))
            ELSE 'null'::jsonb END,
        'last_submitted_at', COALESCE(j.sub->'submitted_at', 'null'::jsonb),
        'open_request_id', COALESCE(j.open_request->'id', 'null'::jsonb)
      ) ORDER BY j.title), '[]'::jsonb)
  ) INTO _result
  FROM judged j;

  RETURN _result;
END;
$$;

-- ============ 6. Dossier status uses validity ============
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
  forms AS (
    SELECT ap.id AS appt_id,
           public.determine_required_forms_for_appointment(ap.id) AS payload
    FROM appt ap
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
  ),
  alerts AS (
    SELECT ap.id AS appt_id,
           count(*) FILTER (WHERE ca.review_status <> 'reviewed') AS open_alerts
    FROM appt ap
    LEFT JOIN public.customer_alerts ca
      ON ca.user_id = _tenant AND ca.customer_id = ap.customer_id
    GROUP BY ap.id
  )
  SELECT ap.id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(f.payload->'required') e
        WHERE e->>'state' <> 'valid'
      ) THEN 'actie_nodig'
      WHEN rn.required AND rn.is_past AND COALESCE(rn.record_status, 'missing') <> 'completed' THEN 'af_te_ronden'
      ELSE 'compleet'
    END,
    jsonb_build_object(
      'forms', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'title', e->>'title',
          'ok', (e->>'state') = 'valid',
          'state', e->>'state',
          'valid_until', e->'valid_until'
        ))
        FROM jsonb_array_elements(f.payload->'required') e
      ), '[]'::jsonb),
      'treatment_record_required', rn.required,
      'treatment_record_status', COALESCE(rn.record_status, 'missing'),
      'before_photos', COALESCE(m.before_count, 0),
      'after_photos', COALESCE(m.after_count, 0),
      'open_alerts', COALESCE(al.open_alerts, 0)
    )
  FROM appt ap
  JOIN forms f ON f.appt_id = ap.id
  JOIN record_need rn ON rn.appt_id = ap.id
  LEFT JOIN media m ON m.appt_id = ap.id
  LEFT JOIN alerts al ON al.appt_id = ap.id;
END;
$$;

-- ============ 7. Customer timeline ============
CREATE OR REPLACE FUNCTION public.customer_dossier_timeline(_customer_id uuid, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
RETURNS TABLE(occurred_at timestamptz, kind text, category text, label text, detail_id uuid, meta jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _content boolean := public.can_view_dossier_content();
BEGIN
  IF _tenant IS NULL OR public.can_view_dossier_status() IS NOT TRUE THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = _customer_id AND c.user_id = _tenant
      AND COALESCE(c.is_demo, false) = public.current_tenant_is_demo()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT fr.sent_at AS occurred_at, 'form_sent'::text AS kind, 'forms'::text AS category,
           COALESCE(ft.title, 'Formulier') || ' verstuurd' AS label, fr.id AS detail_id, '{}'::jsonb AS meta
    FROM public.form_requests fr
    LEFT JOIN public.form_templates ft ON ft.id = fr.template_id
    WHERE fr.user_id = _tenant AND fr.customer_id = _customer_id AND fr.sent_at IS NOT NULL

    UNION ALL
    SELECT fs.submitted_at, 'form_submitted', 'forms',
           COALESCE(ft.title, 'Formulier') || CASE WHEN fs.signed_at IS NOT NULL THEN ' ingevuld en ondertekend' ELSE ' ingevuld' END,
           fs.id, jsonb_build_object('signed', fs.signed_at IS NOT NULL)
    FROM public.form_submissions fs
    LEFT JOIN public.form_templates ft ON ft.id = fs.template_id
    WHERE fs.user_id = _tenant AND fs.customer_id = _customer_id

    UNION ALL
    SELECT a.appointment_date, 'appointment', 'treatments',
           COALESCE(s.name, 'Afspraak'), a.id, jsonb_build_object('status', a.status)
    FROM public.appointments a
    LEFT JOIN public.services s ON s.id = a.service_id
    WHERE a.user_id = _tenant AND a.customer_id = _customer_id
      AND COALESCE(a.is_demo, false) = public.current_tenant_is_demo()

    UNION ALL
    SELECT COALESCE(tr.completed_at, tr.created_at), 'treatment_record', 'treatments',
           CASE WHEN tr.status = 'completed' THEN 'Behandelverslag afgerond' ELSE 'Behandelverslag als concept opgeslagen' END,
           tr.id, jsonb_build_object('status', tr.status)
    FROM public.treatment_records tr
    WHERE tr.user_id = _tenant AND tr.customer_id = _customer_id
      AND (_content OR false)

    UNION ALL
    SELECT cm.created_at, 'photo', 'photos',
           CASE cm.category WHEN 'before' THEN 'Voorfoto toegevoegd'
                            WHEN 'after' THEN 'Nafoto toegevoegd'
                            ELSE 'Controlefoto toegevoegd' END,
           cm.id, jsonb_build_object('category', cm.category)
    FROM public.clinical_media cm
    WHERE cm.user_id = _tenant AND cm.customer_id = _customer_id
      AND (_content OR false)

    UNION ALL
    SELECT ca.created_at, 'alert', 'alerts',
           CASE WHEN _content THEN 'Aandachtspunt: ' || ca.label ELSE 'Aandachtspunt aanwezig' END,
           ca.id, jsonb_build_object('review_status', ca.review_status)
    FROM public.customer_alerts ca
    WHERE ca.user_id = _tenant AND ca.customer_id = _customer_id

    UNION ALL
    SELECT ca.reviewed_at, 'alert_reviewed', 'alerts',
           CASE WHEN ca.review_status = 'action_needed' THEN 'Aandachtspunt: actie nodig' ELSE 'Aandachtspunt beoordeeld' END,
           ca.id, jsonb_build_object('review_status', ca.review_status)
    FROM public.customer_alerts ca
    WHERE ca.user_id = _tenant AND ca.customer_id = _customer_id AND ca.reviewed_at IS NOT NULL
  )
  SELECT e.occurred_at, e.kind, e.category, e.label, e.detail_id, e.meta
  FROM events e
  WHERE e.occurred_at IS NOT NULL
  ORDER BY e.occurred_at DESC
  LIMIT GREATEST(1, LEAST(200, COALESCE(_limit, 25)))
  OFFSET GREATEST(0, COALESCE(_offset, 0));
END;
$$;

-- ============ 8. Indexes ============
CREATE INDEX IF NOT EXISTS idx_form_requests_status_expiry ON public.form_requests (user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_form_requests_appt_status ON public.form_requests (user_id, appointment_id, status);
CREATE INDEX IF NOT EXISTS idx_form_submissions_customer ON public.form_submissions (user_id, customer_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_version ON public.form_submissions (template_version_id);
CREATE INDEX IF NOT EXISTS idx_customer_alerts_review ON public.customer_alerts (user_id, customer_id, review_status);
CREATE INDEX IF NOT EXISTS idx_customer_alerts_created ON public.customer_alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_media_customer ON public.clinical_media (user_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_records_customer ON public.treatment_records (user_id, customer_id, created_at DESC);