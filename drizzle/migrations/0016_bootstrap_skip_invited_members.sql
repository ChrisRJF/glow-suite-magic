CREATE OR REPLACE FUNCTION public.bootstrap_current_user()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _email text;
  _plan_slug text;
  _is_member boolean := false;
  _profile_created boolean := false;
  _role_created boolean := false;
  _settings_created boolean := false;
  _subscription_created boolean := false;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COALESCE((auth.jwt() ->> 'email'), '') INTO _email;
  SELECT COALESCE((auth.jwt() -> 'user_metadata' ->> 'plan'), 'growth') INTO _plan_slug;
  IF _plan_slug NOT IN ('starter', 'growth', 'premium') THEN _plan_slug := 'growth'; END IF;

  -- Invited staff (server-set invited_by in user metadata or an existing salon membership) never get an own salon.
  SELECT EXISTS (SELECT 1 FROM public.user_access WHERE member_user_id = _user_id)
      OR EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id AND COALESCE(raw_user_meta_data->>'invited_by','') <> '')
    INTO _is_member;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id) THEN
    INSERT INTO public.profiles (user_id, email, salon_name) VALUES (_user_id, _email, 'Mijn Salon');
    _profile_created := true;
  END IF;

  IF _is_member THEN
    RETURN jsonb_build_object('profile_created', _profile_created, 'role_created', false,
      'settings_created', false, 'subscription_created', false, 'member', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'eigenaar'::public.app_role);
    _role_created := true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.settings WHERE user_id = _user_id AND is_demo = false) THEN
    INSERT INTO public.settings (user_id, salon_name, demo_mode, is_demo, mollie_mode, language, currency, timezone)
    VALUES (_user_id, 'Mijn Salon', false, false, 'live', 'nl', 'EUR', 'Europe/Amsterdam');
    _settings_created := true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = _user_id) THEN
    INSERT INTO public.subscriptions (user_id, plan_slug, status, trial_started_at, trial_ends_at)
    VALUES (_user_id, _plan_slug, 'trialing', now(), now() + interval '14 days');
    _subscription_created := true;
  END IF;

  RETURN jsonb_build_object('profile_created', _profile_created, 'role_created', _role_created,
    'settings_created', _settings_created, 'subscription_created', _subscription_created);
END;
$function$;