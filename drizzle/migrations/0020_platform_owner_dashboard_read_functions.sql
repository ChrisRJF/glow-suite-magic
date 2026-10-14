CREATE OR REPLACE FUNCTION public.platform_access_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT jsonb_build_object(
    'owner', auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_owners o WHERE o.user_id = auth.uid()),
    'aal2', coalesce(auth.jwt() ->> 'aal','') = 'aal2');
$$;

CREATE OR REPLACE FUNCTION public.platform_require_owner_aal2()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_owners o WHERE o.user_id = uid) THEN
    RAISE EXCEPTION 'not_platform_owner' USING ERRCODE = '42501'; END IF;
  IF coalesce(auth.jwt() ->> 'aal','') <> 'aal2' THEN
    RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501'; END IF;
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public.platform_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE uid uuid := public.platform_require_owner_aal2(); res jsonb;
BEGIN
  INSERT INTO public.audit_logs (user_id, actor_user_id, action, target_type, target_id, details, is_demo)
  VALUES (uid, uid, 'platform_overview', 'platform', 'all', '{}'::jsonb, false);
  WITH s AS (
    SELECT st.user_id AS tenant_id,
           coalesce(nullif(st.salon_name,''), nullif(p.salon_name,''), 'Naamloze salon') AS salon_name,
           st.created_at, coalesce(st.is_demo,false) AS is_demo,
           sub.status, sub.plan_slug, sub.trial_ends_at, sub.canceled_at, sub.cancel_at_period_end,
           sub.past_due_since, sub.free_period_starts_at,
           pl.name AS plan_name, pl.price_cents, pl.interval
    FROM public.settings st
    LEFT JOIN public.profiles p ON p.user_id = st.user_id
    LEFT JOIN public.subscriptions sub ON sub.user_id = st.user_id
    LEFT JOIN public.subscription_plans pl ON pl.slug = sub.plan_slug),
  r AS (SELECT * FROM s WHERE NOT is_demo)
  SELECT jsonb_build_object(
    'salons_total', (SELECT count(*) FROM s),
    'salons_real', (SELECT count(*) FROM r),
    'salons_demo', (SELECT count(*) FROM s WHERE is_demo),
    'subs_active', (SELECT count(*) FROM r WHERE status='active'),
    'subs_trialing', (SELECT count(*) FROM r WHERE status='trialing'),
    'subs_expired', (SELECT count(*) FROM r WHERE status='expired'),
    'subs_pending', (SELECT count(*) FROM r WHERE status='pending'),
    'subs_none', (SELECT count(*) FROM r WHERE status IS NULL),
    'trials_ending_7d', (SELECT count(*) FROM r WHERE status='trialing' AND trial_ends_at BETWEEN now() AND now() + interval '7 days'),
    'cancellations', (SELECT count(*) FROM r WHERE canceled_at IS NOT NULL OR coalesce(cancel_at_period_end,false)),
    'past_due', (SELECT count(*) FROM r WHERE past_due_since IS NOT NULL),
    'free_period', (SELECT count(*) FROM r WHERE free_period_starts_at IS NOT NULL),
    'projected_mrr_cents', (SELECT coalesce(sum(price_cents),0) FROM r WHERE status='active' AND free_period_starts_at IS NULL AND interval='1 month'),
    'salons', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', tenant_id, 'salon_name', salon_name, 'created_at', created_at, 'is_demo', is_demo,
        'status', status, 'plan', coalesce(plan_name, plan_slug), 'trial_ends_at', trial_ends_at,
        'free_period', free_period_starts_at IS NOT NULL) ORDER BY created_at DESC) FROM s), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.platform_usage(_period text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE uid uuid := public.platform_require_owner_aal2(); res jsonb;
BEGIN
  IF _period IS NULL OR _period !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_period'; END IF;
  INSERT INTO public.audit_logs (user_id, actor_user_id, action, target_type, target_id, details, is_demo)
  VALUES (uid, uid, 'platform_usage', 'platform', 'all', jsonb_build_object('period', _period), false);
  WITH real_t AS (SELECT user_id FROM public.settings WHERE NOT coalesce(is_demo,false)),
  a AS (
    SELECT ap.user_id, ap.status, ap.source, ap.created_at,
           to_char(ap.appointment_date AT TIME ZONE 'Europe/Amsterdam','YYYY-MM') AS m
    FROM public.appointments ap JOIN real_t t ON t.user_id = ap.user_id
    WHERE NOT coalesce(ap.is_demo,false)),
  p AS (SELECT * FROM a WHERE m = _period),
  months AS (SELECT to_char(d,'YYYY-MM') m FROM generate_series(
      to_date(_period,'YYYY-MM') - interval '5 months', to_date(_period,'YYYY-MM'), interval '1 month') d)
  SELECT jsonb_build_object(
    'period', _period,
    'total', (SELECT count(*) FROM p),
    'online', (SELECT count(*) FROM p WHERE source='online_booking'),
    'cancelled', (SELECT count(*) FROM p WHERE status='geannuleerd'),
    'no_show', (SELECT count(*) FROM p WHERE status IN ('no-show','no_show')),
    'per_salon', coalesce((SELECT jsonb_object_agg(user_id, x) FROM (
        SELECT t.user_id, jsonb_build_object(
          'appointments', (SELECT count(*) FROM p WHERE p.user_id=t.user_id),
          'last_created_at', (SELECT max(created_at) FROM a WHERE a.user_id=t.user_id)) x
        FROM real_t t) q), '{}'::jsonb),
    'trend', (SELECT jsonb_agg(jsonb_build_object('month', mo.m,
        'total', (SELECT count(*) FROM a WHERE a.m = mo.m)) ORDER BY mo.m) FROM months mo)
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.platform_access_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_require_owner_aal2() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_usage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_access_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_require_owner_aal2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_usage(text) TO authenticated;