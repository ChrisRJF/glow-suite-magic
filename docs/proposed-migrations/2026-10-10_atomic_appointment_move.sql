-- PROPOSED MIGRATION, NOT APPLIED. Needs separate written approval before it is run.
-- Purpose: one transactional, server-authorised move of an agenda appointment
-- (date + start/end time + primary employee). Nothing is half-written: every
-- check runs before the first write and any error rolls the whole call back.
--
-- Availability rules mirror supabase/functions/_shared/inactive/employeeSchedule.ts
-- (used by public-booking v2): full-day absence, weekly_schedule (NULL = legacy
-- working_days + opening hours), custom_hours, opening-hours intersection,
-- breaks, partial exceptions, overlapping appointments (unknown employee =
-- salon-wide block). Differences are listed in docs/prepared-patches/atomic-appointment-move/README.md.
--
-- Concurrency: an advisory transaction lock per tenant + local date serialises
-- moves made through THIS function. public-booking does NOT take this lock
-- (see README); only the existing unique index on exact start time protects
-- that path.

CREATE OR REPLACE FUNCTION public.move_appointment_atomic(
  _appointment_id      uuid,
  _target_date         text,          -- 'YYYY-MM-DD', Europe/Amsterdam local date
  _target_start        text,          -- 'HH:MM', local wall clock, 15-minute grid
  _target_employee_id  uuid,          -- NULL = no employee
  _expected_updated_at timestamptz DEFAULT NULL  -- optimistic check, optional
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
  _emp      public.employees%ROWTYPE;
  _svc      public.services%ROWTYPE;
  _date     date;
  _dow      int;
  _dkey     text;
  _s        int;
  _e        int;
  _dur      int;
  _links    int;
  _cur_emp  uuid;
  _opening  jsonb;
  _day      jsonb;
  _open_st  text := 'unknown';   -- unknown | closed | open
  _open_s   int;
  _open_e   int;
  _win_s    int;
  _win_e    int;
  _ws       jsonb;
  _cust     record;
  _new_ts   timestamptz;
  _hhmm     constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
BEGIN
  -- 1. identity + input validation (no reads yet)
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

  -- 2. authorisation: same rule as the appointments RLS policy (owner in active
  --    demo/live mode) AND an operational role. 'medewerker' and 'financieel'
  --    are denied by default. Unknown and foreign appointments look identical.
  SELECT * INTO _a FROM public.appointments WHERE id = _appointment_id;
  IF NOT FOUND
     OR NOT public.user_row_matches_active_mode(_a.user_id, _a.is_demo)
     OR NOT public.has_any_role(_uid, ARRAY['eigenaar','admin','manager','receptie']::public.app_role[]) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- 3. serialise moves for this tenant + target day, then lock the row
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment_move:' || _a.user_id::text || ':' || _target_date, 0));
  SELECT * INTO _a FROM public.appointments
   WHERE id = _appointment_id AND user_id = _a.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF _a.status IN ('geannuleerd','cancelled','voltooid','completed','no-show','no_show') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;
  IF _expected_updated_at IS NOT NULL AND _a.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'stale');
  END IF;

  -- 4. duration: service of the same tenant, else existing start/end; else fail closed
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

  -- 5. Amsterdam wall clock -> UTC; reject non-existent local times (DST gap)
  _new_ts := (_target_date || ' ' || _target_start)::timestamp AT TIME ZONE 'Europe/Amsterdam';
  IF pg_catalog.to_char(_new_ts AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI')
     <> _target_date || ' ' || _target_start THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_local_time');
  END IF;

  -- 6. current assignment (UUID only; never by name)
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
    -- legacy name-only assignment: never guess (two employees may share a name)
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'legacy_assignment_requires_choice');
  END IF;

  -- 7. idempotent no-op
  IF (_a.appointment_date AT TIME ZONE 'Europe/Amsterdam')::date = _date
     AND _a.start_time = _target_start::time
     AND _cur_emp IS NOT DISTINCT FROM _target_employee_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'noop', 'appointment_id', _a.id);
  END IF;

  -- 8. opening hours of the salon (latest settings row, like current_account_is_demo)
  _dow := extract(isodow FROM _date)::int;
  _dkey := (ARRAY['ma','di','wo','do','vr','za','zo'])[_dow];
  SELECT st.opening_hours INTO _opening FROM public.settings st
   WHERE st.user_id = _a.user_id ORDER BY st.created_at DESC LIMIT 1;
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
  IF _open_st = 'closed' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'salon_closed');
  END IF;

  -- 9. working window
  IF _target_employee_id IS NOT NULL THEN
    SELECT * INTO _emp FROM public.employees
     WHERE id = _target_employee_id AND user_id = _a.user_id AND is_demo = _a.is_demo FOR SHARE;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'unknown_employee');
    END IF;
    IF _emp.is_active IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'employee_inactive');
    END IF;
    IF _svc.id IS NOT NULL AND pg_catalog.jsonb_typeof(_emp.services) = 'array'
       AND pg_catalog.jsonb_array_length(_emp.services) > 0
       AND NOT (_emp.services ? _svc.id::text OR _emp.services ? _svc.name) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_qualified');
    END IF;
    -- full-day absence: employee status window or full-day exception
    IF COALESCE(_emp.status, 'werkzaam') <> 'werkzaam'
       AND (_emp.status_from IS NULL OR _date >= _emp.status_from)
       AND (_emp.status_until IS NULL OR _date <= _emp.status_until) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'employee_absent');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.employee_availability_exceptions x
       WHERE x.employee_id = _emp.id AND x.user_id = _a.user_id
         AND x.type NOT IN ('break','custom_hours')
         AND x.start_time IS NULL AND x.end_time IS NULL
         AND _date BETWEEN x.start_date AND COALESCE(x.end_date, x.start_date)
         AND (x.days_of_week IS NULL OR cardinality(x.days_of_week) = 0 OR _dow = ANY (x.days_of_week))) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'employee_absent');
    END IF;

    IF _emp.weekly_schedule IS NULL THEN
      IF NOT (_dow = ANY (CASE WHEN cardinality(_emp.working_days) > 0 THEN _emp.working_days ELSE ARRAY[1,2,3,4,5] END)) THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_working');
      END IF;
      IF _open_st = 'open' THEN _win_s := _open_s; _win_e := _open_e; ELSE _win_s := 540; _win_e := 1080; END IF;
    ELSE
      IF NOT public.is_valid_weekly_schedule(_emp.weekly_schedule) THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_working');  -- fail closed
      END IF;
      _ws := _emp.weekly_schedule -> _dow::text;
      IF _ws IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_working');
      END IF;
      _win_s := substr(_ws ->> 'start', 1, 2)::int * 60 + substr(_ws ->> 'start', 4, 2)::int;
      _win_e := substr(_ws ->> 'end', 1, 2)::int * 60 + substr(_ws ->> 'end', 4, 2)::int;
    END IF;

    -- custom hours replace the window
    SELECT (extract(hour FROM x.start_time) * 60 + extract(minute FROM x.start_time))::int AS cs,
           (extract(hour FROM x.end_time) * 60 + extract(minute FROM x.end_time))::int AS ce
      INTO _cust
      FROM public.employee_availability_exceptions x
     WHERE x.employee_id = _emp.id AND x.user_id = _a.user_id AND x.type = 'custom_hours'
       AND x.start_time IS NOT NULL AND x.end_time IS NOT NULL
       AND _date BETWEEN x.start_date AND COALESCE(x.end_date, x.start_date)
       AND (x.days_of_week IS NULL OR cardinality(x.days_of_week) = 0 OR _dow = ANY (x.days_of_week))
     ORDER BY x.created_at, x.id LIMIT 1;
    IF FOUND THEN
      _win_s := _cust.cs; _win_e := _cust.ce;
    END IF;
  ELSE
    -- no employee: salon-wide calendar (opening hours, default 09:00-18:00)
    IF _open_st = 'open' THEN _win_s := _open_s; _win_e := _open_e; ELSE _win_s := 540; _win_e := 1080; END IF;
  END IF;

  IF _open_st = 'open' THEN
    _win_s := GREATEST(_win_s, _open_s);
    _win_e := LEAST(_win_e, _open_e);
  END IF;
  IF _win_s IS NULL OR _win_s >= _win_e OR _s < _win_s OR _e > _win_e THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'outside_working_hours');
  END IF;

  -- 10. breaks and partial-day exceptions (employee only)
  IF _target_employee_id IS NOT NULL THEN
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
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'in_break');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.employee_availability_exceptions x
       WHERE x.employee_id = _emp.id AND x.user_id = _a.user_id AND x.type <> 'custom_hours'
         AND x.start_time IS NOT NULL AND x.end_time IS NOT NULL
         AND _date BETWEEN x.start_date AND COALESCE(x.end_date, x.start_date)
         AND (x.days_of_week IS NULL OR cardinality(x.days_of_week) = 0 OR _dow = ANY (x.days_of_week))
         AND _s < (extract(hour FROM x.end_time) * 60 + extract(minute FROM x.end_time))::int
         AND _e > (extract(hour FROM x.start_time) * 60 + extract(minute FROM x.start_time))::int) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'employee_absent');
    END IF;
  END IF;

  -- 11. overlapping appointments of the same tenant (any mode, like public-booking).
  --     Owner = UUID links + appointments.employee_id, limited to employees of this
  --     tenant. No known owner = salon-wide block.
  IF EXISTS (
    WITH o AS (
      SELECT ap.id,
             COALESCE((extract(hour FROM ap.start_time) * 60 + extract(minute FROM ap.start_time))::int,
                      (extract(hour FROM (ap.appointment_date AT TIME ZONE 'Europe/Amsterdam')) * 60
                       + extract(minute FROM (ap.appointment_date AT TIME ZONE 'Europe/Amsterdam')))::int) AS os,
             ap.end_time, ap.service_id, ap.employee_id
        FROM public.appointments ap
       WHERE ap.user_id = _a.user_id AND ap.id <> _a.id
         AND ap.status NOT IN ('geannuleerd','cancelled')
         AND ap.appointment_date >= _new_ts - interval '2 days'
         AND ap.appointment_date <  _new_ts + interval '2 days'
         AND (ap.appointment_date AT TIME ZONE 'Europe/Amsterdam')::date = _date
    ), oe AS (
      SELECT o.id, o.os,
             CASE
               WHEN o.end_time IS NOT NULL THEN
                 CASE WHEN (extract(hour FROM o.end_time) * 60 + extract(minute FROM o.end_time))::int > o.os
                      THEN (extract(hour FROM o.end_time) * 60 + extract(minute FROM o.end_time))::int ELSE 1440 END
               ELSE o.os + COALESCE((SELECT sv.duration_minutes FROM public.services sv
                                      WHERE sv.id = o.service_id AND sv.user_id = _a.user_id AND sv.duration_minutes > 0), 30)
             END AS oe_min,
             o.employee_id
        FROM o
    ), owners AS (
      SELECT oe.id, oe.os, oe.oe_min,
             ARRAY(
               SELECT e.id FROM public.employees e
                WHERE e.user_id = _a.user_id
                  AND (e.id IN (SELECT ae.employee_id FROM public.appointment_employees ae WHERE ae.appointment_id = oe.id)
                       OR e.id::text = oe.employee_id)
             ) AS emps
        FROM oe
    )
    SELECT 1 FROM owners
     WHERE os < _e AND oe_min > _s
       AND (cardinality(emps) = 0 OR (_target_employee_id IS NOT NULL AND _target_employee_id = ANY (emps)))) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  -- 12. writes: appointment + primary link in one transaction
  BEGIN
    UPDATE public.appointments
       SET appointment_date = _new_ts,
           start_time = _target_start::time,
           end_time = (pg_catalog.make_interval(mins => _e))::time,
           employee_id = _target_employee_id::text
     WHERE id = _a.id;
    DELETE FROM public.appointment_employees WHERE appointment_id = _a.id;
    IF _target_employee_id IS NOT NULL THEN
      INSERT INTO public.appointment_employees (appointment_id, employee_id, user_id, is_primary, is_demo)
      VALUES (_a.id, _target_employee_id, _a.user_id, true, _a.is_demo);
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- e.g. idx_appointments_unique_employee_start hit by a concurrent public booking;
    -- the sub-block is rolled back, nothing is written.
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'conflict');
  END;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'moved', 'appointment_id', _a.id,
    'appointment_date', _new_ts, 'start_time', _target_start,
    'end_time', pg_catalog.to_char((pg_catalog.make_interval(mins => _e))::time, 'HH24:MI'),
    'employee_id', _target_employee_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) IS
  'Atomic agenda move (date, time, primary employee). Owner in active mode + eigenaar/admin/manager/receptie only. Proposed 2026-10-10.';
