-- Part 1: WhatsApp central architecture - add usage tracking + limits

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS monthly_included_messages integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS overage_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_review_request boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_settings
  ALTER COLUMN from_number DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month text NOT NULL, -- YYYY-MM
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  billable_count integer NOT NULL DEFAULT 0,
  included_limit integer NOT NULL DEFAULT 300,
  overage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

ALTER TABLE public.whatsapp_usage_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own whatsapp usage" ON public.whatsapp_usage_monthly;
CREATE POLICY "Users can view own whatsapp usage"
  ON public.whatsapp_usage_monthly FOR SELECT
  USING (auth.uid() = user_id);

-- Service role only writes (no insert/update/delete from client)

CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_user_month
  ON public.whatsapp_usage_monthly (user_id, month);

-- Atomic increment function
CREATE OR REPLACE FUNCTION public.increment_whatsapp_usage(
  _user_id uuid,
  _sent integer,
  _failed integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _month text := to_char(now() AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM');
  _limit integer;
BEGIN
  SELECT COALESCE(monthly_included_messages, 300) INTO _limit
  FROM public.whatsapp_settings WHERE user_id = _user_id;
  IF _limit IS NULL THEN _limit := 300; END IF;

  INSERT INTO public.whatsapp_usage_monthly (user_id, month, sent_count, failed_count, billable_count, included_limit, overage_count)
  VALUES (_user_id, _month, _sent, _failed, _sent, _limit, GREATEST(0, _sent - _limit))
  ON CONFLICT (user_id, month) DO UPDATE
    SET sent_count = whatsapp_usage_monthly.sent_count + EXCLUDED.sent_count,
        failed_count = whatsapp_usage_monthly.failed_count + EXCLUDED.failed_count,
        billable_count = whatsapp_usage_monthly.billable_count + EXCLUDED.sent_count,
        included_limit = _limit,
        overage_count = GREATEST(0, (whatsapp_usage_monthly.billable_count + EXCLUDED.sent_count) - _limit),
        updated_at = now();
END;
$$;

-- Part 3: Fix appointments unique constraint to allow group bookings.
-- The previous index blocked any 2+ rows with same (user_id, appointment_date) and NULL employee.
-- We now allow them when they share a booking_group_id (legitimate group booking).

DROP INDEX IF EXISTS public.idx_appointments_unique_unassigned_start;
DROP INDEX IF EXISTS public.idx_appointments_unique_employee_start;

-- Per-employee uniqueness: same employee cannot have two appointments at same start time
-- (group bookings of same family with different employees are fine)
CREATE UNIQUE INDEX idx_appointments_unique_employee_start
  ON public.appointments (user_id, employee_id, appointment_date)
  WHERE employee_id IS NOT NULL
    AND status NOT IN ('geannuleerd','cancelled')
    AND booking_group_id IS NULL;

-- Unassigned uniqueness: only enforce for non-group bookings
CREATE UNIQUE INDEX idx_appointments_unique_unassigned_start
  ON public.appointments (user_id, appointment_date)
  WHERE employee_id IS NULL
    AND status NOT IN ('geannuleerd','cancelled')
    AND booking_group_id IS NULL;
