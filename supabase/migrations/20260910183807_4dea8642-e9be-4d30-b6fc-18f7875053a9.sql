
-- ---------------------------------------------------------------- consents
CREATE TABLE public.customer_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('marketing_media')),
  scope text NOT NULL CHECK (scope IN ('marketing_general','advertising')),
  event text NOT NULL CHECK (event IN ('granted','withdrawn')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'salon' CHECK (source IN ('salon','form','booking','import')),
  source_reference uuid,
  version integer,
  proof_reference uuid,
  actor_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.customer_consents TO authenticated;
GRANT ALL ON public.customer_consents TO service_role;
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_customer_consents_lookup
  ON public.customer_consents (user_id, customer_id, consent_type, scope, occurred_at DESC);
CREATE UNIQUE INDEX idx_customer_consents_form_proof
  ON public.customer_consents (proof_reference, scope)
  WHERE proof_reference IS NOT NULL AND source = 'form';

CREATE OR REPLACE FUNCTION public.can_manage_consent()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tenant_id() IS NOT NULL
     AND public.has_any_role(auth.uid(), ARRAY['eigenaar','admin','manager']::public.app_role[])
     AND NOT public.has_role(auth.uid(), 'financieel'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.can_view_consent_history()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_dossier_content()
$$;

CREATE POLICY "Dossier staff can read consent history"
ON public.customer_consents FOR SELECT TO authenticated
USING (
  user_id = public.current_tenant_id()
  AND public.user_row_matches_active_mode(user_id, is_demo)
  AND public.can_view_consent_history()
);

-- Append only: writes go through the security definer RPCs below.
CREATE OR REPLACE FUNCTION public.block_consent_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer_consents is append-only';
END;
$$;
CREATE TRIGGER customer_consents_append_only
BEFORE UPDATE OR DELETE ON public.customer_consents
FOR EACH ROW EXECUTE FUNCTION public.block_consent_mutation();

-- ------------------------------------------------------------ media columns
ALTER TABLE public.clinical_media
  ADD COLUMN IF NOT EXISTS marketing_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_approved_by uuid;

ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS consent_scope text
    CHECK (consent_scope IS NULL OR consent_scope IN ('marketing_general','advertising'));

-- --------------------------------------------------------------- derivation
CREATE OR REPLACE FUNCTION public.current_consent_status(_customer_id uuid, _scope text, _consent_type text DEFAULT 'marketing_media')
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN c.event = 'granted' THEN 'granted' ELSE 'withdrawn' END
       FROM public.customer_consents c
      WHERE c.customer_id = _customer_id
        AND c.consent_type = _consent_type
        AND c.scope = _scope
      ORDER BY c.occurred_at DESC, c.created_at DESC
      LIMIT 1),
    'not_given');
$$;

CREATE OR REPLACE FUNCTION public.can_use_media_for_marketing(_media_id uuid, _scope text DEFAULT 'marketing_general')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.clinical_media m
      JOIN public.customers cu ON cu.id = m.customer_id AND cu.user_id = m.user_id
     WHERE m.id = _media_id
       AND m.marketing_approved = true
       AND m.storage_path IS NOT NULL
       AND public.current_consent_status(m.customer_id, _scope) = 'granted'
  );
$$;

REVOKE ALL ON FUNCTION public.block_consent_mutation() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_consent_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_use_media_for_marketing(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_consent() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_consent_history() TO authenticated, service_role;
