-- Server-side candidate narrowing for the Auto Rebook hub.
-- Returns only the raw visit history; the canonical TypeScript engine still
-- makes every decision. Narrowing is deliberately weaker than the engine
-- (7 days = AUTO_REBOOK_MIN_DAYS) so it can never change an outcome.
CREATE OR REPLACE FUNCTION public.auto_rebook_candidates(_max_customers integer DEFAULT 2000)
RETURNS TABLE(customer_id uuid, appointments jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_scheduler_cursor(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_scheduler_cursor(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_rebook_revenue() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_rebook_candidates(integer) FROM anon;