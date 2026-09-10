
-- ============ Tenant + permission helpers ============
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cnt integer;
  _owner uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Owners are their own tenant.
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'eigenaar'::public.app_role) THEN
    RETURN _uid;
  END IF;

  SELECT count(DISTINCT ua.owner_user_id), min(ua.owner_user_id)
    INTO _cnt, _owner
  FROM public.user_access ua
  WHERE ua.member_user_id = _uid
    AND ua.status = 'active';

  IF _cnt = 1 THEN
    RETURN _owner;
  END IF;

  IF _cnt > 1 THEN
    -- Ambiguous membership is a data inconsistency: deny access, never guess.
    RAISE WARNING 'current_tenant_id: ambiguous tenant membership for user %', _uid;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_tenant_is_demo()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT s.is_demo OR COALESCE(s.demo_mode, false)
    FROM public.settings s
    WHERE s.user_id = public.current_tenant_id()
    ORDER BY s.created_at DESC
    LIMIT 1
  ), false)
$$;

REVOKE ALL ON FUNCTION public.current_tenant_is_demo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_is_demo() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_view_dossier_status()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
     AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager','medewerker','receptie']::public.app_role[])
$$;

CREATE OR REPLACE FUNCTION public.can_view_dossier_content()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
     AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager','medewerker']::public.app_role[])
     AND NOT public.has_role(auth.uid(), 'receptie'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'financieel'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.can_send_customer_form()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
     AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager','medewerker','receptie']::public.app_role[])
$$;

CREATE OR REPLACE FUNCTION public.can_manage_form_templates()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
     AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
$$;

REVOKE ALL ON FUNCTION public.can_view_dossier_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_dossier_content() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_send_customer_form() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_form_templates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_dossier_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_dossier_content() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_send_customer_form() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_form_templates() TO authenticated, service_role;

-- ============ form_templates ============
CREATE TABLE public.form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'intake',
  is_active boolean NOT NULL DEFAULT true,
  require_signature boolean NOT NULL DEFAULT false,
  current_version integer NOT NULL DEFAULT 0,
  draft_schema jsonb NOT NULL DEFAULT '{"fields": []}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_templates_kind_check CHECK (kind IN ('intake','questionnaire','consent','contract'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_templates TO authenticated;
GRANT ALL ON public.form_templates TO service_role;
ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff can view templates" ON public.form_templates
FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_status());

CREATE POLICY "Managers can insert templates" ON public.form_templates
FOR INSERT TO authenticated
WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates());

CREATE POLICY "Managers can update templates" ON public.form_templates
FOR UPDATE TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates())
WITH CHECK (user_id = public.current_tenant_id() AND public.can_manage_form_templates());

CREATE POLICY "Managers can delete templates" ON public.form_templates
FOR DELETE TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates());

CREATE TRIGGER form_templates_updated_at BEFORE UPDATE ON public.form_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_form_templates_tenant ON public.form_templates(user_id, is_demo, is_active);

-- ============ form_template_versions ============
CREATE TABLE public.form_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  require_signature boolean NOT NULL DEFAULT false,
  schema jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_template_versions_unique UNIQUE (template_id, version)
);
GRANT SELECT, INSERT ON public.form_template_versions TO authenticated;
GRANT ALL ON public.form_template_versions TO service_role;
ALTER TABLE public.form_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff can view versions" ON public.form_template_versions
FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_status());

CREATE POLICY "Managers can publish versions" ON public.form_template_versions
FOR INSERT TO authenticated
WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates());

CREATE INDEX idx_form_template_versions_template ON public.form_template_versions(template_id, version DESC);

CREATE OR REPLACE FUNCTION public.block_published_version_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Published form versions are immutable';
END;
$$;

CREATE TRIGGER form_template_versions_immutable
BEFORE UPDATE OR DELETE ON public.form_template_versions
FOR EACH ROW EXECUTE FUNCTION public.block_published_version_change();

-- ============ service_form_requirements ============
CREATE TABLE public.service_form_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_form_requirements_unique UNIQUE (user_id, service_id, template_id)
);
GRANT SELECT, INSERT, DELETE ON public.service_form_requirements TO authenticated;
GRANT ALL ON public.service_form_requirements TO service_role;
ALTER TABLE public.service_form_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff can view requirements" ON public.service_form_requirements
FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_status());

CREATE POLICY "Managers can insert requirements" ON public.service_form_requirements
FOR INSERT TO authenticated
WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates());

CREATE POLICY "Managers can delete requirements" ON public.service_form_requirements
FOR DELETE TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_manage_form_templates());

CREATE INDEX idx_service_form_requirements_service ON public.service_form_requirements(user_id, service_id);

-- ============ form_requests ============
CREATE TABLE public.form_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.form_template_versions(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  channel text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_requests_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT form_requests_status_check CHECK (status IN ('draft','sent','opened','completed','expired','cancelled'))
);
GRANT SELECT, INSERT, UPDATE ON public.form_requests TO authenticated;
GRANT ALL ON public.form_requests TO service_role;
ALTER TABLE public.form_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier staff can view requests" ON public.form_requests
FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_status());

CREATE POLICY "Staff can create requests" ON public.form_requests
FOR INSERT TO authenticated
WITH CHECK (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_send_customer_form());

CREATE POLICY "Staff can update requests" ON public.form_requests
FOR UPDATE TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_send_customer_form())
WITH CHECK (user_id = public.current_tenant_id() AND public.can_send_customer_form());

CREATE TRIGGER form_requests_updated_at BEFORE UPDATE ON public.form_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_form_requests_customer ON public.form_requests(user_id, customer_id, status);
CREATE INDEX idx_form_requests_appointment ON public.form_requests(user_id, appointment_id);

-- ============ form_submissions ============
CREATE TABLE public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  request_id uuid NOT NULL REFERENCES public.form_requests(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.form_template_versions(id) ON DELETE RESTRICT,
  answers jsonb NOT NULL,
  rendered_snapshot jsonb NOT NULL,
  document_hash text NOT NULL,
  signer_name text,
  signed_at timestamptz,
  signature_data text,
  audit_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_submissions_request_unique UNIQUE (request_id)
);
GRANT SELECT ON public.form_submissions TO authenticated;
GRANT ALL ON public.form_submissions TO service_role;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

-- Content is readable only by roles allowed to see dossier content.
CREATE POLICY "Dossier content readers can view submissions" ON public.form_submissions
FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND is_demo = public.current_tenant_is_demo() AND public.can_view_dossier_content());

CREATE OR REPLACE FUNCTION public.block_submission_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Form submissions are immutable';
END;
$$;

CREATE TRIGGER form_submissions_immutable
BEFORE UPDATE OR DELETE ON public.form_submissions
FOR EACH ROW EXECUTE FUNCTION public.block_submission_change();

CREATE INDEX idx_form_submissions_customer ON public.form_submissions(user_id, customer_id, submitted_at DESC);
CREATE INDEX idx_form_submissions_appointment ON public.form_submissions(user_id, appointment_id);
