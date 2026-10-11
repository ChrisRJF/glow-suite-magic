CREATE TABLE IF NOT EXISTS public.customer_email_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  sending_enabled boolean NOT NULL DEFAULT false,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
REVOKE ALL ON public.customer_email_controls FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_email_controls TO service_role;
ALTER TABLE public.customer_email_controls ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.customer_email_controls_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.customer_email_controls_touch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER customer_email_controls_touch BEFORE UPDATE ON public.customer_email_controls
  FOR EACH ROW EXECUTE FUNCTION public.customer_email_controls_touch();
INSERT INTO public.customer_email_controls (id, sending_enabled, reason, updated_by)
VALUES (true, true, 'initial: manual confirmation worker rollout', 'migration')
ON CONFLICT (id) DO NOTHING;
DO $v$
DECLARE r text; p text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','public','sandbox_exec'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.customer_email_controls', p) THEN RAISE EXCEPTION 'controls: % has %', r, p; END IF;
    END LOOP;
  END LOOP;
END
$v$;