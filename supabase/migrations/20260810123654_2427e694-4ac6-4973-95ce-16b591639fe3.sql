CREATE OR REPLACE FUNCTION public.sync_auto_rebook_revenue(_appointment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _appt public.appointments%ROWTYPE;
  _status text;
  _pay text;
  _conf text;
  _completed boolean;
  _dead boolean;
  _reversed_pay boolean;
  _refunded numeric := 0;
BEGIN
  IF _appointment_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rebook_actions WHERE appointment_id = _appointment_id) THEN
    RETURN;
  END IF;

  SELECT * INTO _appt FROM public.appointments WHERE id = _appointment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  _status := lower(COALESCE(_appt.status, ''));
  _pay := lower(COALESCE(_appt.payment_status, ''));
  _conf := lower(COALESCE(_appt.confirmation_status, ''));

  _completed := _status IN ('voltooid', 'completed', 'afgerond', 'done');
  _dead := _status IN ('geannuleerd','cancelled','canceled','no_show','no-show','noshow','niet_verschenen','declined')
           OR _conf = 'declined';
  _reversed_pay := _pay IN ('refunded','terugbetaald','reversed','chargeback','charged_back','geannuleerd','cancelled');

  -- Provider-independent refunded total, scoped to THIS appointment only.
  -- Group booking safety: payments of other group members carry their own
  -- appointment_id and never enter this sum.
  SELECT COALESCE(sum(x.refunded), 0) INTO _refunded
  FROM (
    SELECT GREATEST(
             COALESCE(p.refunded_amount, 0),
             COALESCE((
               SELECT sum(r.amount)
               FROM public.payment_refunds r
               WHERE r.payment_id = p.id
                 AND lower(COALESCE(r.status, '')) IN ('refunded','succeeded','processed','completed','paid','done')
             ), 0),
             CASE
               WHEN lower(COALESCE(p.status, '')) IN ('refunded','terugbetaald','reversed','chargeback','charged_back')
                 THEN COALESCE(p.amount, 0)
               ELSE 0
             END
           ) AS refunded
    FROM public.payments p
    WHERE p.appointment_id = _appointment_id
  ) x;

  IF _dead THEN
    UPDATE public.rebook_actions
      SET realized_revenue = NULL,
          realized_at = NULL,
          reversed_revenue = COALESCE(attributed_revenue, 0),
          reversed_at = now(),
          reversal_reason = CASE WHEN _conf = 'declined' THEN 'appointment_declined' ELSE 'appointment_' || _status END,
          status = 'vervallen'
      WHERE appointment_id = _appointment_id;
    RETURN;
  END IF;

  IF _completed THEN
    UPDATE public.rebook_actions ra
      SET realized_revenue = CASE
            WHEN _reversed_pay THEN NULL
            WHEN GREATEST(0, COALESCE(ra.attributed_revenue, 0) - _refunded) <= 0 AND _refunded > 0 THEN NULL
            ELSE GREATEST(0, COALESCE(ra.attributed_revenue, 0) - _refunded)
          END,
          realized_at = CASE
            WHEN _reversed_pay OR (GREATEST(0, COALESCE(ra.attributed_revenue, 0) - _refunded) <= 0 AND _refunded > 0) THEN NULL
            ELSE COALESCE(ra.realized_at, now())
          END,
          reversed_revenue = CASE
            WHEN _reversed_pay THEN COALESCE(ra.attributed_revenue, 0)
            WHEN _refunded > 0 THEN LEAST(_refunded, COALESCE(ra.attributed_revenue, 0))
            ELSE NULL
          END,
          reversed_at = CASE
            WHEN _reversed_pay OR _refunded > 0 THEN now()
            ELSE NULL
          END,
          reversal_reason = CASE
            WHEN _reversed_pay THEN 'payment_' || _pay
            WHEN _refunded > 0 AND _refunded >= COALESCE(ra.attributed_revenue, 0) THEN 'payment_refunded'
            WHEN _refunded > 0 THEN 'payment_partially_refunded'
            ELSE NULL
          END,
          status = CASE
            WHEN _reversed_pay OR (GREATEST(0, COALESCE(ra.attributed_revenue, 0) - _refunded) <= 0 AND _refunded > 0) THEN 'vervallen'
            ELSE 'gerealiseerd'
          END
      WHERE ra.appointment_id = _appointment_id;
  END IF;
END;
$function$;

-- The appointment trigger now delegates to the canonical helper.
CREATE OR REPLACE FUNCTION public.sync_rebook_revenue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.sync_auto_rebook_revenue(NEW.id);
  RETURN NEW;
END;
$function$;

-- Payments (Mollie, Viva, terminal, manual) all land in public.payments.
CREATE OR REPLACE FUNCTION public.sync_rebook_revenue_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    PERFORM public.sync_auto_rebook_revenue(NEW.appointment_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.appointment_id IS NOT NULL AND OLD.appointment_id IS DISTINCT FROM NEW.appointment_id THEN
    PERFORM public.sync_auto_rebook_revenue(OLD.appointment_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_rebook_revenue_payment ON public.payments;
CREATE TRIGGER trg_sync_rebook_revenue_payment
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_rebook_revenue_from_payment();

CREATE OR REPLACE FUNCTION public.sync_rebook_revenue_from_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _appt uuid;
BEGIN
  SELECT p.appointment_id INTO _appt FROM public.payments p WHERE p.id = NEW.payment_id;
  IF _appt IS NOT NULL THEN
    PERFORM public.sync_auto_rebook_revenue(_appt);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_rebook_revenue_refund ON public.payment_refunds;
CREATE TRIGGER trg_sync_rebook_revenue_refund
AFTER INSERT OR UPDATE ON public.payment_refunds
FOR EACH ROW EXECUTE FUNCTION public.sync_rebook_revenue_from_refund();

-- Server-side count for the hub so large salons are never silently truncated.
CREATE OR REPLACE FUNCTION public.auto_rebook_candidates(_max_customers integer DEFAULT 2000, _offset integer DEFAULT 0)
RETURNS TABLE(customer_id uuid, appointments jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid, public.current_account_is_demo() AS demo),
  scoped AS (
    SELECT a.customer_id, a.id, a.service_id, a.appointment_date, a.status, a.price
    FROM public.appointments a, me
    WHERE a.user_id = me.uid
      AND COALESCE(a.is_demo, false) = me.demo
      AND a.customer_id IS NOT NULL
      AND a.appointment_date >= now() - interval '730 days'
  ),
  eligible AS (
    SELECT s.customer_id
    FROM scoped s
    GROUP BY s.customer_id
    HAVING bool_or(
             lower(COALESCE(s.status,'')) IN ('voltooid','completed','afgerond','done')
             AND s.appointment_date <= now() - interval '7 days'
           )
       AND NOT bool_or(
             s.appointment_date > now()
             AND lower(COALESCE(s.status,'')) NOT IN
                 ('geannuleerd','cancelled','canceled','no_show','no-show','noshow','niet_verschenen','declined')
           )
    ORDER BY s.customer_id
    OFFSET GREATEST(0, COALESCE(_offset, 0))
    LIMIT GREATEST(1, COALESCE(_max_customers, 2000))
  )
  SELECT e.customer_id,
         jsonb_agg(jsonb_build_object(
           'id', s.id,
           'service_id', s.service_id,
           'appointment_date', s.appointment_date,
           'status', s.status,
           'price', s.price
         ))
  FROM eligible e
  JOIN scoped s ON s.customer_id = e.customer_id
  GROUP BY e.customer_id;
$function$;

GRANT EXECUTE ON FUNCTION public.auto_rebook_candidates(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_auto_rebook_revenue(uuid) TO service_role;