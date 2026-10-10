-- PROPOSED MIGRATION, NOT APPLIED. Needs separate written approval before it is run.
-- Version 2 (fase 2). Purpose:
--   * public.move_appointment_atomic: one transactional, server-authorised agenda move.
--   * public.create_public_booking_atomic: online booking re-check + insert of all lines
--     (groups) + employee links in ONE transaction, under the SAME lock as moves.
-- Shared pieces:
--   * lock key 'appointment_slot:<tenant>:<local date>' (pg_advisory_xact_lock) taken by both RPCs
--   * public.appointment_slot_check: availability rules (mirror of booking v2 employeeSchedule.ts)
--   * public.appointment_busy_candidates: reads old wall-clock-as-UTC and new real-UTC rows;
--     rows that fit neither are 'ambiguous' and block BOTH readings (fail closed).
--   * public.amsterdam_wall_to_utc: wall clock -> real UTC; NULL for DST gap and DST repeat hour.
-- Every new write stores appointment_date as REAL UTC of the Amsterdam wall clock and
-- start_time/end_time as wall clock. No bulk conversion of existing rows.

-- ---------------------------------------------------------------------------
-- 1. time helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.amsterdam_wall_to_utc(_date text, _time text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  _wall text := _date || ' ' || _time;
  _ts   timestamptz;
BEGIN
  IF _date IS NULL OR _time IS NULL
     OR _date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR _time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    _ts := _wall::timestamp AT TIME ZONE 'Europe/Amsterdam';
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  -- spring-forward gap: wall clock does not exist
  IF pg_catalog.to_char(_ts AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') <> _wall THEN
    RETURN NULL;
  END IF;
  -- fall-back repeat hour: the same wall clock exists twice -> refuse, never guess
  IF pg_catalog.to_char((_ts - interval '1 hour') AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') = _wall
     OR pg_catalog.to_char((_ts + interval '1 hour') AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') = _wall THEN
    RETURN NULL;
  END IF;
  RETURN _ts;
END;
$fn$;

-- kind: canonical (real UTC, start_time = Amsterdam clock), legacy (calendar: start_time = UTC
-- clock of the stored value), ambiguous (start_time missing or matches neither; one row per reading).
CREATE OR REPLACE FUNCTION public.appointment_busy_candidates(
  _ts timestamptz, _start time, _end time, _fallback_minutes int)
RETURNS TABLE(kind text, local_date date, s int, e int)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  _ams timestamp := _ts AT TIME ZONE 'Europe/Amsterdam';
  _utc timestamp := _ts AT TIME ZONE 'UTC';
  _k   text;
  _dur int;
  _m   int;
  _t   timestamp;
BEGIN
  IF _ts IS NULL THEN RETURN; END IF;
  IF _start IS NOT NULL AND pg_catalog.to_char(_ams, 'HH24:MI') = pg_catalog.to_char(_start, 'HH24:MI') THEN
    _k := 'canonical';
  ELSIF _start IS NOT NULL AND pg_catalog.to_char(_utc, 'HH24:MI') = pg_catalog.to_char(_start, 'HH24:MI') THEN
    _k := 'legacy';
  ELSE
    _k := 'ambiguous';
  END IF;
  IF _start IS NOT NULL AND _end IS NOT NULL AND _end > _start THEN
    _dur := (extract(epoch FROM (_end - _start)) / 60)::int;
  END IF;
  FOREACH _t IN ARRAY CASE _k WHEN 'canonical' THEN ARRAY[_ams] WHEN 'legacy' THEN ARRAY[_utc] ELSE ARRAY[_ams, _utc] END LOOP
    _m := (extract(hour FROM _t) * 60 + extract(minute FROM _t))::int;
    kind := _k; local_date := _t::date; s := _m;
    IF _k <> 'ambiguous' AND _end IS NOT NULL THEN
      e := (extract(hour FROM _end) * 60 + extract(minute FROM _end))::int;
      IF e <= _m THEN e := 1440; END IF;
    ELSE
      e := LEAST(1440, _m + COALESCE(_dur, NULLIF(_fallback_minutes, 0), 30));
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. shared availability check (booking v2 rules). NULL = free, else a code.
--    Not callable by app roles; only used inside the two SECURITY DEFINER RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.appointment_slot_check(
  _tenant uuid, _is_demo boolean, _opening jsonb, _date date, _s int, _e int,
  _employee_id uuid, _service_id uuid, _service_name text, _exclude_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $fn$
DECLARE
  _emp     public.employees%ROWTYPE;
  _dow     int := extract(isodow FROM _date)::int;
  _dkey    text := (ARRAY['ma','di','wo','do','vr','za','zo'])[extract(isodow FROM _date)::int];
  _day     jsonb;
  _open_st text := 'unknown';
  _open_s  int;
  _open_e  int;
  _win_s   int;
  _win_e   int;
  _ws      jsonb;
  _cust    record;
  _hhmm    constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
BEGIN
  IF _e > 1440 OR _s < 0 OR _s >= _e THEN RETURN 'outside_hours'; END IF;

  -- opening hours
  IF _opening IS NOT NULL AND pg_catalog.jsonb_typeof(_opening) = 'object' AND _opening ? _dkey THEN
    _day := _opening -> _dkey;
    IF pg_catalog.jsonb_typeof(_day) = 'object' AND (_day ->> 'enabled') = 'false' THEN
      _open_st := 'closed';
    ELSIF substr(COALESCE(_day ->> 'open', ''), 1, 5) ~ _hhmm AND substr(COALESCE(_day ->> 'close', ''), 1, 5) ~ _hhmm THEN
      _open_s := substr(_day ->> 'open', 1, 2)::int * 60 + substr(_day ->> 'open', 4, 2)::int;
      _open_e := substr(_day ->> 'close', 1, 2)::int * 60 + substr(_day ->> 'close', 4, 2)::int;
      _open_st := CASE WHEN _open_s < _open_e THEN 'open' ELSE 'closed' END;
    ELSE
      _open_st := 'closed';
    END IF;
  END IF;
  IF _open_st = 'closed' THEN RETURN 'salon_closed'; END IF;

  IF _employee_id IS NOT NULL THEN
    SELECT * INTO _emp FROM public.employees
     WHERE id = _employee_id AND user_id = _tenant AND is_demo = _is_demo FOR SHARE;
    IF NOT FOUND THEN RETURN 'unknown_employee'; END IF;
    IF _emp.is_active IS NOT TRUE THEN RETURN 'employee_inactive'; END IF;
    IF _service_id IS NOT NULL AND pg_catalog.jsonb_typeof(_emp.services) = 'array'
       AND pg_catalog.jsonb_array_length(_emp.services) > 0
       AND NOT (_emp.services ? _service_id::text OR _emp.services ? COALESCE(_service_name, '')) THEN
      RETURN 'not_qualified';
    END IF;
    IF COALESCE(_emp.status, 'werkzaam') <> 'werkzaam'
       AND (_emp.status_from IS NULL OR _date >= _emp.status_from)
       AND (_emp.status_until IS NULL OR _date <= _emp.status_until) THEN
      RETURN 'employee_absent';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.employee_availability_exceptions x
       WHERE x.employee_id = _emp.id AND x.user_id = _tenant
         AND x.type NOT IN ('break','custom_hours')
         AND x.start_time IS NULL AND x.end_time IS NULL
         AND _date BETWEEN x.start_date AND COALESCE(x.end_date, x.start_date)
         AND (x.days_of_week IS NULL OR cardinality(x.days_of_week) = 0 OR _dow = ANY (x.days_of_week))) THEN
      RETURN 'employee_absent';
    END IF;

    IF _emp.weekly_schedule IS NULL THEN
      IF NOT (_dow = ANY (CASE WHEN cardinality(_emp.working_days) > 0 THEN _emp.working_days ELSE ARRAY[1,2,3,4,5] END)) THEN
        RETURN 'not_working';
      END IF;
      IF _open_st = 'open' THEN _win_s := _open_s; _win_e := _open_e; ELSE _win_s := 540; _win_e := 1080; END IF;
    ELSE
      IF NOT public.is_valid_weekly_schedule(_emp.weekly_schedule) THEN RETURN 'not_working'; END IF;
      _ws := _emp.weekly_schedule -> _dow::text;
      IF _ws IS NULL THEN RETURN 'not_working'; END IF;
      _win_s := substr(_ws ->> 'start', 1, 2)::int * 60 + substr(_ws ->> 'start', 4, 2)::int;
      _win_e := substr(_ws ->> 'end', 1, 2)::int * 60 + substr(_ws ->> 'end', 4, 2)::int;
    END IF;

    SELECT (extract(hour FROM x.start_time) * 60 + extract(minute FROM x.start_time))::int AS cs,
           (extract(hour FROM x.end_time) * 60 + extract(minute FROM x.end_time))::int AS ce
      INTO _cust
      FROM public.employee_availability_exceptions x
     WHERE x.employee_id = _emp.id AND x.user_id = _tenant AND x.type = 'custom_hours'
       AND x.start_time IS NOT NULL AND x.end_time IS NOT NULL
       AND _date BETWEEN x.start_date AND COALESCE(x.end_date, x.start_date)
       AND (x.days_of_week IS NULL OR cardinality(x.days_of_week) = 0 OR _dow = ANY (x.days_of_week))
     ORDER BY x.created_at, x.id LIMIT 1;
    IF FOUND THEN _win_s := _cust.cs; _win_e := _cust.ce; END IF;
  ELSE
    IF _open_st = 'open' THEN _win_s := _open_s; _win_e := _open_e; ELSE _win_s := 540; _win_e := 1080; END IF;
  END IF;

  IF _open_st = 'open' THEN
    _win_s := GREATEST(_win_s, _open_s);
    _win_e := LEAST(_win_e, _open_e);
  END IF;
  IF _win_s IS NULL OR _win_s >= _win_e OR _s < _win_s OR _e > _win_e THEN
    RETURN 'outside_working_hours';
  END IF;

  IF _employee_id IS NOT NULL THEN
    IF EXISTS (
      WITH b AS (
        SELECT substr(v ->> 'start', 1, 5) AS bs, substr(v ->> 'end', 1, 5) AS be, v -> 'days' AS days
          FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(_emp.breaks) = 'array' THEN _emp.breaks ELSE '[]'::jsonb END) v
         WHERE pg_catalog.jsonb_typeof(v) = 'object'
           AND substr(COALESCE(v ->> 'start', ''), 1, 5) ~ _hhmm AND substr(COALESCE(v ->> 'end', ''), 1, 5) ~ _hhmm
      ), allb AS (
        SELECT bs, be, days FROM b
        UNION ALL
        SELECT pg_catalog.to_char(_emp.break_start, 'HH24:MI'), pg_catalog.to_char(_emp.break_end, 'HH24:MI'), NULL
         WHERE NOT EXISTS (SELECT 1 FROM b) AND _emp.break_start IS NOT NULL AND _emp.break_end IS NOT NULL
      )
      SELECT 1 FROM allb
       WHERE (days IS NULL OR pg_catalog.jsonb_typeof(days) <> 'array' OR pg_catalog.jsonb_array_length(days) = 0
              OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(days) d WHERE d ~ '^[0-9]+$' AND d::int = _dow))
         AND _s < substr(be, 1, 2)::int * 60 + substr(be, 4, 2)::int
         AND _e > substr(bs, 1, 2)::int * 60 + substr(bs, 4, 2)::int) THEN
      RETURN 'in_break';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.employee_availability_exceptions x
       WHERE x.employee_id = _emp.id AND x.user_id = _tenant AND x.type <> 'custom_hours'
         AND x.start_time IS NOT NULL AND x.end_time IS NOT NULL
         AND _date BETWEEN x.start_date AND COALESCE(x.end_date, x.start_date)
         AND (x.days_of_week IS NULL OR cardinality(x.days_of_week) = 0 OR _dow = ANY (x.days_of_week))
         AND _s < (extract(hour FROM x.end_time) * 60 + extract(minute FROM x.end_time))::int
         AND _e > (extract(hour FROM x.start_time) * 60 + extract(minute FROM x.start_time))::int) THEN
      RETURN 'employee_absent';
    END IF;
  END IF;

  -- overlapping appointments of this tenant (any mode). Old and new time storage both read;
  -- ambiguous rows block both readings. No known owner = salon-wide block.
  IF EXISTS (
    SELECT 1
      FROM public.appointments ap
      CROSS JOIN LATERAL public.appointment_busy_candidates(
        ap.appointment_date, ap.start_time, ap.end_time,
        (SELECT sv.duration_minutes FROM public.services sv
          WHERE sv.id = ap.service_id AND sv.user_id = _tenant AND sv.duration_minutes > 0)) c
     WHERE ap.user_id = _tenant
       AND (_exclude_id IS NULL OR ap.id <> _exclude_id)
       AND ap.status NOT IN ('geannuleerd','cancelled')
       AND ap.appointment_date >= (_date::timestamp - interval '2 days') AT TIME ZONE 'UTC'
       AND ap.appointment_date <  (_date::timestamp + interval '3 days') AT TIME ZONE 'UTC'
       AND c.local_date = _date
       AND c.s < _e AND c.e > _s
       AND (
         NOT EXISTS (
           SELECT 1 FROM public.employees e
            WHERE e.user_id = _tenant
              AND (e.id IN (SELECT ae.employee_id FROM public.appointment_employees ae WHERE ae.appointment_id = ap.id)
                   OR e.id::text = ap.employee_id))
         OR (_employee_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.employees e
            WHERE e.user_id = _tenant AND e.id = _employee_id
              AND (e.id IN (SELECT ae.employee_id FROM public.appointment_employees ae WHERE ae.appointment_id = ap.id)
                   OR e.id::text = ap.employee_id))))) THEN
    RETURN 'conflict';
  END IF;
  RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. atomic move (agenda). _expected_updated_at is REQUIRED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_appointment_atomic(
  _appointment_id      uuid,
  _target_date         text,          -- 'YYYY-MM-DD', Europe/Amsterdam local date
  _target_start        text,          -- 'HH:MM', local wall clock, 15-minute grid
  _target_employee_id  uuid,          -- NULL = no employee
  _expected_updated_at timestamptz    -- required optimistic version; NULL -> missing_version
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _uid      uuid := auth.uid();
  _a        public.appointments%ROWTYPE;
  _svc      public.services%ROWTYPE;
  _date     date;
  _s        int;
  _e        int;
  _dur      int;
  _links    int;
  _cur_emp  uuid;
  _opening  jsonb;
  _src      record;
  _new_ts   timestamptz;
  _now      timestamptz;
  _code     text;
  _hhmm     constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
BEGIN
  -- 1. identity + input validation
  IF _uid IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF _appointment_id IS NULL OR _target_date IS NULL OR _target_start IS NULL
     OR _target_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR _target_start !~ _hhmm THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;
  BEGIN
    _date := _target_date::date;
  EXCEPTION WHEN others THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END;
  IF pg_catalog.to_char(_date, 'YYYY-MM-DD') <> _target_date THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;
  _s := substr(_target_start, 1, 2)::int * 60 + substr(_target_start, 4, 2)::int;
  IF _s % 15 <> 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;

  -- 2. authorisation (appointments RLS rule + operational role); unknown == foreign
  SELECT * INTO _a FROM public.appointments WHERE id = _appointment_id;
  IF NOT FOUND
     OR NOT public.user_row_matches_active_mode(_a.user_id, _a.is_demo)
     OR NOT public.has_any_role(_uid, ARRAY['eigenaar','admin','manager','receptie']::public.app_role[]) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF _expected_updated_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'missing_version');
  END IF;

  -- 3. shared lock (same key as create_public_booking_atomic), then row lock, then version
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment_slot:' || _a.user_id::text || ':' || _target_date, 0));
  SELECT * INTO _a FROM public.appointments
   WHERE id = _appointment_id AND user_id = _a.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF _a.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'stale');
  END IF;
  IF _a.status IN ('geannuleerd','cancelled','voltooid','completed','no-show','no_show') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;

  -- 4. duration
  IF _a.service_id IS NOT NULL THEN
    SELECT * INTO _svc FROM public.services WHERE id = _a.service_id AND user_id = _a.user_id;
  END IF;
  IF _svc.id IS NOT NULL AND _svc.duration_minutes > 0 THEN
    _dur := _svc.duration_minutes;
  ELSIF _a.start_time IS NOT NULL AND _a.end_time IS NOT NULL AND _a.end_time > _a.start_time THEN
    _dur := (extract(epoch FROM (_a.end_time - _a.start_time)) / 60)::int;
  END IF;
  IF _dur IS NULL OR _dur <= 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'unknown_duration');
  END IF;
  _e := _s + _dur;
  IF _e > 1440 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'outside_hours');
  END IF;

  -- 5. wall clock -> real UTC; DST gap and repeat hour refused
  _new_ts := public.amsterdam_wall_to_utc(_target_date, _target_start);
  IF _new_ts IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_local_time');
  END IF;

  -- 6. source time must be readable (old or new storage); otherwise fail closed
  SELECT * INTO _src FROM public.appointment_busy_candidates(_a.appointment_date, _a.start_time, _a.end_time, _dur) LIMIT 1;
  IF _src.kind IS DISTINCT FROM 'canonical' AND _src.kind IS DISTINCT FROM 'legacy' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ambiguous_time');
  END IF;

  -- 7. current assignment (UUID only; never by name)
  SELECT count(*)::int, min(ae.employee_id::text)::uuid INTO _links, _cur_emp
    FROM public.appointment_employees ae WHERE ae.appointment_id = _a.id;
  IF _links > 1 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'multi_employee_unsupported');
  END IF;
  IF _links = 0 AND _a.employee_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT e.id INTO _cur_emp FROM public.employees e
     WHERE e.id = _a.employee_id::uuid AND e.user_id = _a.user_id;
  END IF;
  IF _links = 0 AND _cur_emp IS NULL AND _target_employee_id IS NULL
     AND COALESCE(_a.notes, '') LIKE '%Medewerker:%' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'legacy_assignment_requires_choice');
  END IF;

  -- 8. idempotent no-op (only after lock + version check)
  IF _src.local_date = _date AND _src.s = _s
     AND _cur_emp IS NOT DISTINCT FROM _target_employee_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'noop', 'appointment_id', _a.id,
                                         'updated_at', _a.updated_at);
  END IF;

  -- 9. availability (shared rules)
  SELECT st.opening_hours INTO _opening FROM public.settings st
   WHERE st.user_id = _a.user_id ORDER BY st.created_at DESC LIMIT 1;
  _code := public.appointment_slot_check(_a.user_id, _a.is_demo, _opening, _date, _s, _e,
                                         _target_employee_id, _svc.id, _svc.name, _a.id);
  IF _code IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', _code);
  END IF;

  -- 10. writes in one transaction (always new canonical storage)
  _now := pg_catalog.clock_timestamp();
  BEGIN
    UPDATE public.appointments
       SET appointment_date = _new_ts,
           start_time = _target_start::time,
           end_time = (pg_catalog.make_interval(mins => _e))::time,
           employee_id = _target_employee_id::text,
           updated_at = _now
     WHERE id = _a.id
    RETURNING updated_at INTO _now;  -- a live updated_at trigger may override the value
    DELETE FROM public.appointment_employees WHERE appointment_id = _a.id;
    IF _target_employee_id IS NOT NULL THEN
      INSERT INTO public.appointment_employees (appointment_id, employee_id, user_id, is_primary, is_demo)
      VALUES (_a.id, _target_employee_id, _a.user_id, true, _a.is_demo);
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'conflict');
  END;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'moved', 'appointment_id', _a.id,
    'appointment_date', _new_ts, 'start_time', _target_start,
    'end_time', pg_catalog.to_char((pg_catalog.make_interval(mins => _e))::time, 'HH24:MI'),
    'employee_id', _target_employee_id, 'updated_at', _now);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. atomic online booking. Only service_role (public-booking Edge Function) may execute.
--    Tenant is resolved from the public slug INSIDE the function, never taken from the caller.
--    _lines: [{ "time":"HH:MM", "service_id":uuid, "employee_id":uuid|null, "notes":text }]
--    _common: { customer_id, status, payment_status, payment_required, deposit_amount,
--               payment_type, source_first, accepted_glowsuite_terms, accepted_salon_terms,
--               accepted_terms_at }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_public_booking_atomic(
  _slug   text,
  _date   text,
  _lines  jsonb,
  _common jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _st       record;
  _n        int;
  _tenant   uuid;
  _is_demo  boolean;
  _d        date;
  _line     jsonb;
  _i        int := 0;
  _svc      public.services%ROWTYPE;
  _emp_id   uuid;
  _s        int;
  _e        int;
  _ts       timestamptz;
  _code     text;
  _group    uuid;
  _cust     uuid;
  _status   text;
  _pstatus  text;
  _ptype    text;
  _source   text;
  _new_id   uuid;
  _out      jsonb := '[]'::jsonb;
  _hhmm     constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  _uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  -- input shape
  IF _slug IS NULL OR length(_slug) NOT BETWEEN 1 AND 120 OR _date IS NULL
     OR _date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR _lines IS NULL OR pg_catalog.jsonb_typeof(_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(_lines) NOT BETWEEN 1 AND 10
     OR _common IS NULL OR pg_catalog.jsonb_typeof(_common) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;
  BEGIN
    _d := _date::date;
  EXCEPTION WHEN others THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END;
  IF pg_catalog.to_char(_d, 'YYYY-MM-DD') <> _date THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;

  -- tenant from slug only (exactly one settings row)
  SELECT count(*)::int INTO _n FROM public.settings WHERE public_slug = _slug;
  IF _n <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  SELECT user_id, opening_hours, (is_demo OR COALESCE(demo_mode, false)) AS demo INTO _st
    FROM public.settings WHERE public_slug = _slug;
  _tenant := _st.user_id; _is_demo := _st.demo;

  -- whitelisted common fields
  _status  := COALESCE(_common ->> 'status', 'confirmed');
  _pstatus := COALESCE(_common ->> 'payment_status', 'unpaid');
  _ptype   := COALESCE(_common ->> 'payment_type', 'deposit');
  _source  := COALESCE(_common ->> 'source_first', 'online_booking');
  IF _status NOT IN ('confirmed','pending_confirmation')
     OR _pstatus NOT IN ('unpaid','pending')
     OR _ptype NOT IN ('deposit','full','remainder')
     OR _source NOT IN ('online_booking','auto_rebook')
     OR COALESCE(_common ->> 'customer_id', '') !~ _uuid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;
  _cust := (_common ->> 'customer_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _cust AND c.user_id = _tenant) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END IF;

  IF _d < (pg_catalog.now() AT TIME ZONE 'Europe/Amsterdam')::date THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'slot_unavailable');
  END IF;

  -- same lock as moves for this salon + local day; held until commit
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment_slot:' || _tenant::text || ':' || _date, 0));

  IF pg_catalog.jsonb_array_length(_lines) > 1 THEN _group := gen_random_uuid(); END IF;

  BEGIN
    FOR _line IN SELECT v FROM pg_catalog.jsonb_array_elements(_lines) v LOOP
      _i := _i + 1;
      IF pg_catalog.jsonb_typeof(_line) <> 'object'
         OR COALESCE(_line ->> 'time', '') !~ _hhmm
         OR COALESCE(_line ->> 'service_id', '') !~ _uuid
         OR (_line ? 'employee_id' AND _line -> 'employee_id' <> 'null'::jsonb
             AND COALESCE(_line ->> 'employee_id', '') !~ _uuid) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs:invalid_input';
      END IF;
      SELECT * INTO _svc FROM public.services
       WHERE id = (_line ->> 'service_id')::uuid AND user_id = _tenant AND duration_minutes > 0;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs:invalid_input'; END IF;
      _emp_id := NULLIF(_line ->> 'employee_id', '')::uuid;
      _s := substr(_line ->> 'time', 1, 2)::int * 60 + substr(_line ->> 'time', 4, 2)::int;
      _e := _s + _svc.duration_minutes;
      _ts := public.amsterdam_wall_to_utc(_date, _line ->> 'time');
      IF _ts IS NULL OR _ts < pg_catalog.now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs:slot_unavailable';
      END IF;
      -- re-check under the lock; sees lines inserted earlier in this same call (groups)
      _code := public.appointment_slot_check(_tenant, _is_demo, _st.opening_hours, _d, _s, _e,
                                             _emp_id, _svc.id, _svc.name, NULL);
      IF _code IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'gs:' || _code;
      END IF;
      INSERT INTO public.appointments (
        user_id, is_demo, customer_id, service_id, appointment_date, start_time, end_time,
        employee_id, price, notes, status, payment_status, payment_required, deposit_amount,
        source, booking_group_id, payment_type, accepted_glowsuite_terms, accepted_salon_terms, accepted_terms_at)
      VALUES (
        _tenant, _is_demo, _cust, _svc.id, _ts, (_line ->> 'time')::time,
        (pg_catalog.make_interval(mins => LEAST(_e, 1439)))::time,
        _emp_id::text, COALESCE(_svc.price, 0), left(COALESCE(_line ->> 'notes', ''), 2000),
        _status, _pstatus, COALESCE((_common ->> 'payment_required')::boolean, false),
        GREATEST(0, LEAST(100000, COALESCE((_common ->> 'deposit_amount')::numeric, 0))),
        CASE WHEN _i = 1 THEN _source ELSE 'online_booking' END, _group, _ptype,
        COALESCE((_common ->> 'accepted_glowsuite_terms')::boolean, false),
        COALESCE((_common ->> 'accepted_salon_terms')::boolean, false),
        NULLIF(_common ->> 'accepted_terms_at', '')::timestamptz)
      RETURNING id INTO _new_id;
      IF _emp_id IS NOT NULL THEN
        INSERT INTO public.appointment_employees (appointment_id, employee_id, user_id, is_primary, is_demo)
        VALUES (_new_id, _emp_id, _tenant, true, _is_demo);
      END IF;
      _out := _out || pg_catalog.jsonb_build_array((
        SELECT pg_catalog.jsonb_build_object('id', a.id, 'booking_token', a.booking_token,
               'appointment_date', a.appointment_date, 'start_time', pg_catalog.to_char(a.start_time, 'HH24:MI'),
               'end_time', pg_catalog.to_char(a.end_time, 'HH24:MI'), 'employee_id', a.employee_id,
               'service_id', a.service_id, 'payment_status', a.payment_status, 'status', a.status,
               'price', a.price)
          FROM public.appointments a WHERE a.id = _new_id));
    END LOOP;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'slot_unavailable');
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'gs:%' THEN
        -- every line of this call is rolled back (sub-block), nothing half-written
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', substr(SQLERRM, 4), 'line', _i);
      END IF;
      RAISE;
    WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_input');
  END;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'booked', 'booking_group_id', _group,
                                       'appointments', _out);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.amsterdam_wall_to_utc(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appointment_busy_candidates(timestamptz, time, time, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appointment_slot_check(uuid, boolean, jsonb, date, int, int, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.create_public_booking_atomic(text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking_atomic(text, text, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) IS
  'Atomic agenda move. Required version check after row lock. Shared slot lock with create_public_booking_atomic. Proposed 2026-10-10 v2.';
COMMENT ON FUNCTION public.create_public_booking_atomic(text, text, jsonb, jsonb) IS
  'Online booking: lock + re-check + insert of all lines and employee links in one transaction. service_role only. Proposed 2026-10-10 v2.';
