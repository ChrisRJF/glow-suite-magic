-- PROPOSED (not applied). Global stop switch for customer emails (send-white-label-email only).
-- Apply BEFORE deploying the secured function. Seeds sending_enabled = true so existing booking
-- confirmations and reminders keep flowing at the moment the new function goes live.
-- The function reads this row on every send request, without cache; a missing row,
-- a value other than true, or a database error blocks sending (fail-closed).
CREATE TABLE IF NOT EXISTS public.customer_email_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  sending_enabled boolean NOT NULL DEFAULT false,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

REVOKE ALL ON public.customer_email_controls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_email_controls TO service_role;

ALTER TABLE public.customer_email_controls ENABLE ROW LEVEL SECURITY;
-- No policies: app users (anon/authenticated) can neither read nor change the switch.

CREATE OR REPLACE FUNCTION public.customer_email_controls_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS customer_email_controls_touch ON public.customer_email_controls;
CREATE TRIGGER customer_email_controls_touch BEFORE UPDATE ON public.customer_email_controls
  FOR EACH ROW EXECUTE FUNCTION public.customer_email_controls_touch();

-- Part of this additive change: the single control row, sending enabled.
INSERT INTO public.customer_email_controls (id, sending_enabled, reason, updated_by)
VALUES (true, true, 'initial: secured email function rollout', 'migration')
ON CONFLICT (id) DO NOTHING;
