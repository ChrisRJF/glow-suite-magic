CREATE TABLE public.document_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('form','treatment_record','appointment_bundle','full_dossier')),
  source_id uuid,
  include_photos boolean NOT NULL DEFAULT false,
  photo_count integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf','zip')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  document_ref text NOT NULL,
  idempotency_key text,
  storage_path text,
  file_bytes integer,
  error_code text,
  requested_by uuid,
  download_count integer NOT NULL DEFAULT 0,
  last_downloaded_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX document_exports_idem_idx ON public.document_exports (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX document_exports_customer_idx ON public.document_exports (user_id, customer_id, created_at DESC);
CREATE INDEX document_exports_expiry_idx ON public.document_exports (expires_at) WHERE storage_path IS NOT NULL;

GRANT SELECT ON public.document_exports TO authenticated;
GRANT ALL ON public.document_exports TO service_role;

ALTER TABLE public.document_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier content roles read own exports"
ON public.document_exports FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_view_dossier_content() AND public.user_row_matches_active_mode(user_id, is_demo));

CREATE TABLE public.document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  export_id uuid NOT NULL REFERENCES public.document_exports(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  max_downloads integer NOT NULL DEFAULT 10,
  download_count integer NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  last_downloaded_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_shares_export_idx ON public.document_shares (user_id, export_id, created_at DESC);
CREATE INDEX document_shares_expiry_idx ON public.document_shares (expires_at) WHERE status = 'active';

GRANT SELECT ON public.document_shares TO authenticated;
GRANT ALL ON public.document_shares TO service_role;

ALTER TABLE public.document_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dossier content roles read own shares"
ON public.document_shares FOR SELECT TO authenticated
USING (user_id = public.current_tenant_id() AND public.can_view_dossier_content() AND public.user_row_matches_active_mode(user_id, is_demo));

CREATE TRIGGER update_document_exports_updated_at BEFORE UPDATE ON public.document_exports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_document_shares_updated_at BEFORE UPDATE ON public.document_shares
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();