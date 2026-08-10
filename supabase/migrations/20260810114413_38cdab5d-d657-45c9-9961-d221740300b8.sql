-- 1. Service-level rebook interval ("Terugkomadvies")
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS rebook_interval_days integer NULL;

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_rebook_interval_days_range;
ALTER TABLE public.services
  ADD CONSTRAINT services_rebook_interval_days_range
  CHECK (rebook_interval_days IS NULL OR (rebook_interval_days >= 7 AND rebook_interval_days <= 365));

-- 2. Auto Rebook attribution fields on the existing rebook_actions table
ALTER TABLE public.rebook_actions
  ADD COLUMN IF NOT EXISTS service_id uuid NULL,
  ADD COLUMN IF NOT EXISTS expected_return_date date NULL,
  ADD COLUMN IF NOT EXISTS days_overdue integer NULL,
  ADD COLUMN IF NOT EXISTS reason text NULL,
  ADD COLUMN IF NOT EXISTS channel text NULL,
  ADD COLUMN IF NOT EXISTS message_log_id uuid NULL,
  ADD COLUMN IF NOT EXISTS rebook_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS booked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS appointment_id uuid NULL,
  ADD COLUMN IF NOT EXISTS attributed_revenue numeric NULL,
  ADD COLUMN IF NOT EXISTS estimated_value numeric NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS rebook_actions_token_key
  ON public.rebook_actions (rebook_token);

-- Canonical claim key: one rebook action per customer + service + return moment
CREATE UNIQUE INDEX IF NOT EXISTS rebook_actions_cycle_key
  ON public.rebook_actions (
    user_id,
    customer_id,
    COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    expected_return_date
  )
  WHERE expected_return_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS rebook_actions_user_created_idx
  ON public.rebook_actions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rebook_actions_appointment_idx
  ON public.rebook_actions (appointment_id);

DROP TRIGGER IF EXISTS update_rebook_actions_updated_at ON public.rebook_actions;
CREATE TRIGGER update_rebook_actions_updated_at
  BEFORE UPDATE ON public.rebook_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rebook_actions TO authenticated;
GRANT ALL ON public.rebook_actions TO service_role;

-- 3. Atomic claim: returns the new rebook_action row id, or NULL when another
--    scheduler tick already claimed this exact rebook cycle.
CREATE OR REPLACE FUNCTION public.claim_auto_rebook(
  _user_id uuid,
  _customer_id uuid,
  _service_id uuid,
  _expected_return_date date,
  _days_overdue integer,
  _reason text,
  _estimated_value numeric,
  _is_demo boolean
)
RETURNS TABLE (id uuid, rebook_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.rebook_actions (
    user_id, customer_id, service_id, expected_return_date, days_overdue,
    reason, estimated_value, is_demo, status
  )
  VALUES (
    _user_id, _customer_id, _service_id, _expected_return_date, _days_overdue,
    _reason, _estimated_value, COALESCE(_is_demo, false), 'claimed'
  )
  ON CONFLICT DO NOTHING
  RETURNING public.rebook_actions.id, public.rebook_actions.rebook_token;
END;
$$;
