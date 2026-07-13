
-- ============================================================
-- Scheduler lease lock (advisory-style, TTL-based)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scheduler_locks (
  lock_name     text PRIMARY KEY,
  holder        text,
  acquired_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
GRANT ALL ON public.scheduler_locks TO service_role;
ALTER TABLE public.scheduler_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.scheduler_locks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_acquire_scheduler_lock(
  _name text,
  _ttl_seconds integer DEFAULT 300,
  _holder text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _ins boolean;
BEGIN
  INSERT INTO public.scheduler_locks(lock_name, holder, acquired_at, expires_at)
  VALUES (_name, _holder, _now, _now + make_interval(secs => _ttl_seconds))
  ON CONFLICT (lock_name) DO UPDATE
    SET holder = EXCLUDED.holder,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at
    WHERE public.scheduler_locks.expires_at < _now
  RETURNING true INTO _ins;
  RETURN COALESCE(_ins, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_scheduler_lock(_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.scheduler_locks WHERE lock_name = _name;
$$;

-- ============================================================
-- Cross-channel reminder dispatch claim
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reminder_dispatch_claims (
  appointment_id  uuid NOT NULL,
  reminder_type   text NOT NULL,
  channel         text NOT NULL,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, reminder_type)
);
GRANT ALL ON public.reminder_dispatch_claims TO service_role;
ALTER TABLE public.reminder_dispatch_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.reminder_dispatch_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.claim_reminder_dispatch(
  _appointment_id uuid,
  _reminder_type text,
  _channel text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.reminder_dispatch_claims(appointment_id, reminder_type, channel)
  VALUES (_appointment_id, _reminder_type, _channel)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;

-- ============================================================
-- Public endpoint rate limiter
-- ============================================================
CREATE TABLE IF NOT EXISTS public.public_rate_limits (
  bucket_key      text PRIMARY KEY,
  hit_count       integer NOT NULL DEFAULT 0,
  window_ends_at  timestamptz NOT NULL
);
GRANT ALL ON public.public_rate_limits TO service_role;
ALTER TABLE public.public_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.public_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.check_public_rate_limit(
  _bucket text,
  _max integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _row public.public_rate_limits%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.public_rate_limits WHERE bucket_key = _bucket FOR UPDATE;
  IF NOT FOUND OR _row.window_ends_at < _now THEN
    INSERT INTO public.public_rate_limits(bucket_key, hit_count, window_ends_at)
    VALUES (_bucket, 1, _now + make_interval(secs => _window_seconds))
    ON CONFLICT (bucket_key) DO UPDATE
      SET hit_count = 1,
          window_ends_at = _now + make_interval(secs => _window_seconds);
    RETURN true;
  END IF;
  IF _row.hit_count >= _max THEN
    RETURN false;
  END IF;
  UPDATE public.public_rate_limits
    SET hit_count = hit_count + 1
    WHERE bucket_key = _bucket;
  RETURN true;
END;
$$;

-- ============================================================
-- Atomic No-show prevention toggle
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_noshow_prevention(
  _enabled boolean,
  _reminder_template text,
  _no_show_template text,
  _booking_confirmation_template text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.whatsapp_settings(
    user_id, send_reminders, send_no_show_followup, send_booking_confirmation
  ) VALUES (_uid, _enabled, _enabled, _enabled)
  ON CONFLICT (user_id) DO UPDATE
    SET send_reminders = _enabled,
        send_no_show_followup = _enabled,
        send_booking_confirmation = _enabled,
        updated_at = now();

  INSERT INTO public.whatsapp_templates(user_id, template_type, is_active, content)
  VALUES
    (_uid, 'reminder', _enabled, _reminder_template),
    (_uid, 'no_show', _enabled, _no_show_template),
    (_uid, 'booking_confirmation', _enabled, _booking_confirmation_template)
  ON CONFLICT (user_id, template_type) DO UPDATE
    SET is_active = _enabled,
        updated_at = now();
END;
$$;

-- ============================================================
-- DB-level dedup guard on whatsapp_logs
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_logs_reminder_sent
  ON public.whatsapp_logs(appointment_id, reminder_type)
  WHERE reminder_type IS NOT NULL AND status IN ('sent', 'demo');
