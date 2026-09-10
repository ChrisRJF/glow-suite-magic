
ALTER TABLE public.customer_consents ADD COLUMN IF NOT EXISTS seq bigserial;
CREATE INDEX IF NOT EXISTS idx_customer_consents_seq
  ON public.customer_consents (customer_id, consent_type, scope, seq DESC);

CREATE OR REPLACE FUNCTION public.current_consent_status(_customer_id uuid, _scope text, _consent_type text DEFAULT 'marketing_media')
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN c.event = 'granted' THEN 'granted' ELSE 'withdrawn' END
       FROM public.customer_consents c
      WHERE c.customer_id = _customer_id
        AND c.consent_type = _consent_type
        AND c.scope = _scope
      ORDER BY c.occurred_at DESC, c.seq DESC
      LIMIT 1),
    'not_given');
$$;
