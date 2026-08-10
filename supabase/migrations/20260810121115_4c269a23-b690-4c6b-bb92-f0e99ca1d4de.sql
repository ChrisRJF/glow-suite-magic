-- ============================================================
-- AUTO REBOOK 1.0 — PRODUCTION COMPLETION
-- ============================================================

-- ---------- PART 1: revenue lifecycle ----------
ALTER TABLE public.rebook_actions
  ADD COLUMN IF NOT EXISTS last_appointment_id uuid,
  ADD COLUMN IF NOT EXISTS realized_revenue numeric,
  ADD COLUMN IF NOT EXISTS realized_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_revenue numeric,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

-- ---------- PART 6: stable cycle identity ----------
DROP INDEX IF EXISTS public.rebook_actions_cycle_key;

CREATE UNIQUE INDEX IF NOT EXISTS rebook_actions_visit_cycle_key
  ON public.rebook_actions (user_id, customer_id, last_appointment_id)
  WHERE last_appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rebook_actions_legacy_cycle_key
  ON public.rebook_actions (
    user_id, customer_id,
    COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    expected_return_date
  )
  WHERE last_appointment_id IS NULL AND expected_return_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS rebook_actions_token_expiry_idx
  ON public.rebook_actions (token_expires_at)
  WHERE booked_at IS NULL;

-- ---------- PART 2: retention consent ----------
-- Backward compatible: default false means "not explicitly refused".
-- Channel consent (whatsapp_opt_in / *_opt_out) is still checked separately,
-- so nobody silently gains a consent they did not have before.
ALTER TABLE public.customer_message_preferences
  ADD COLUMN IF NOT EXISTS retention_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_opt_out_at timestamptz;

-- ---------- PART 4: scheduler pagination / fairness cursors ----------
CREATE TABLE IF NOT EXISTS public.scheduler_cursors (
  scheduler_name text PRIMARY KEY,
  cursor_value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scheduler_cursors TO service_role;
ALTER TABLE public.scheduler_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.scheduler_cursors;
CREATE POLICY "service role only" ON public.scheduler_cursors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_scheduler_cursor(_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cursor_value FROM public.scheduler_cursors WHERE scheduler_name = _name;
$$;

CREATE OR REPLACE FUNCTION public.set_scheduler_cursor(_name text, _value text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.scheduler_cursors(scheduler_name, cursor_value, updated_at)
  VALUES (_name, _value, now())
  ON CONFLICT (scheduler_name) DO UPDATE
    SET cursor_value = EXCLUDED.cursor_value, updated_at = now();
$$;

-- ---------- indexes for candidate narrowing ----------
CREATE INDEX IF NOT EXISTS idx_appointments_customer_history
  ON public.appointments (user_id, customer_id, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_customers_user_mode_keyset
  ON public.customers (user_id, is_demo, id);

-- ---------- PART 6: claim with stable visit cycle identity ----------
DROP FUNCTION IF EXISTS public.claim_auto_rebook(uuid, uuid, uuid, date, integer, text, numeric, boolean);

CREATE OR REPLACE FUNCTION public.claim_auto_rebook(
  _user_id uuid,
  _customer_id uuid,
  _service_id uuid,
  _expected_return_date date,
  _days_overdue integer,
  _reason text,
  _estimated_value numeric,
  _is_demo boolean,
  _last_appointment_id uuid DEFAULT NULL,
  _token_ttl_days integer DEFAULT 60
)
RETURNS TABLE(id uuid, rebook_token uuid, token_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- One completed visit may only ever produce a single Auto Rebook cycle,
  -- regardless of later interval changes.
  IF _last_appointment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rebook_actions ra
    WHERE ra.user_id = _user_id
      AND ra.customer_id = _customer_id
      AND ra.last_appointment_id = _last_appointment_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.rebook_actions (
    user_id, customer_id, service_id, expected_return_date, days_overdue,
    reason, estimated_value, is_demo, status, last_appointment_id, token_expires_at
  )
  VALUES (
    _user_id, _customer_id, _service_id, _expected_return_date, _days_overdue,
    _reason, _estimated_value, COALESCE(_is_demo, false), 'claimed',
    _last_appointment_id, now() + make_interval(days => GREATEST(7, COALESCE(_token_ttl_days, 60)))
  )
  ON CONFLICT DO NOTHING
  RETURNING public.rebook_actions.id,
            public.rebook_actions.rebook_token,
            public.rebook_actions.token_expires_at;
END;
$$;

-- ---------- PART 1: realized / reversed revenue trigger ----------
CREATE OR REPLACE FUNCTION public.sync_rebook_revenue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _status text := lower(COALESCE(NEW.status, ''));
  _pay text := lower(COALESCE(NEW.payment_status, ''));
  _conf text := lower(COALESCE(NEW.confirmation_status, ''));
  _completed boolean;
  _dead boolean;
  _refunded boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rebook_actions WHERE appointment_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  _completed := _status IN ('voltooid', 'completed', 'afgerond', 'done');
  _dead := _status IN ('geannuleerd','cancelled','canceled','no_show','no-show','noshow','niet_verschenen','declined')
           OR _conf = 'declined';
  _refunded := _pay IN ('refunded','terugbetaald','reversed','chargeback','geannuleerd','cancelled');

  IF _dead OR _refunded THEN
    UPDATE public.rebook_actions
      SET realized_revenue = NULL,
          realized_at = NULL,
          reversed_revenue = COALESCE(attributed_revenue, 0),
          reversed_at = now(),
          reversal_reason = CASE WHEN _dead THEN 'appointment_' || _status ELSE 'payment_' || _pay END,
          status = 'vervallen'
      WHERE appointment_id = NEW.id;
  ELSIF _completed THEN
    UPDATE public.rebook_actions
      SET realized_revenue = COALESCE(attributed_revenue, 0),
          realized_at = COALESCE(realized_at, now()),
          reversed_revenue = NULL,
          reversed_at = NULL,
          reversal_reason = NULL,
          status = 'gerealiseerd'
      WHERE appointment_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_rebook_revenue ON public.appointments;
CREATE TRIGGER trg_sync_rebook_revenue
  AFTER UPDATE OF status, payment_status, confirmation_status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.sync_rebook_revenue();

-- ---------- PART 3: atomic Auto Rebook master toggle ----------
CREATE OR REPLACE FUNCTION public.set_auto_rebook(_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.whatsapp_settings (user_id, send_revenue_boost)
  VALUES (_uid, _enabled)
  ON CONFLICT (user_id) DO UPDATE
    SET send_revenue_boost = _enabled, updated_at = now();

  INSERT INTO public.whatsapp_templates (user_id, template_type, is_active, content)
  VALUES (_uid, 'revenue_boost', _enabled, '')
  ON CONFLICT (user_id, template_type) DO UPDATE
    SET is_active = _enabled, updated_at = now();

  -- Turning Auto Rebook off must also stop everything already in flight.
  IF NOT _enabled THEN
    UPDATE public.rebook_actions
      SET status = 'suppressed', updated_at = now()
      WHERE user_id = _uid AND status IN ('claimed', 'retry') AND booked_at IS NULL;

    UPDATE public.whatsapp_logs
      SET dead_letter = true, next_retry_at = NULL, status = 'suppressed', error = 'auto_rebook_disabled'
      WHERE user_id = _uid
        AND reminder_type = 'auto_rebook'
        AND status = 'failed'
        AND dead_letter = false
        AND next_retry_at IS NOT NULL;
  END IF;
END;
$$;

-- ---------- PART 14: demo seed scope correction ----------
UPDATE public.rebook_actions ra
SET is_demo = true
WHERE ra.is_demo = false
  AND EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = ra.customer_id AND c.is_demo = true
  );