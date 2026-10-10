\set ON_ERROR_STOP 1
-- Step 1 applied, NO activation yet: every new function refused for anon, authenticated, service_role
DO $$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.amsterdam_wall_to_utc(text,text)','public.minutes_to_wall_time(integer)',
    'public.appointment_busy_candidates(timestamptz,time,time,integer)',
    'public.appointment_slot_check(uuid,boolean,jsonb,date,integer,integer,uuid,uuid,text,uuid)',
    'public.move_appointment_atomic(uuid,text,text,uuid,timestamptz)',
    'public.create_appointment_atomic(uuid,uuid,text,text,uuid[],text,text,uuid,integer,jsonb)',
    'public.create_public_booking_atomic(text,text,jsonb,jsonb)'] LOOP
    FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
      IF has_function_privilege(CASE WHEN r='public' THEN 'anon' ELSE r END, f, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: % can execute %', r, f;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname IN ('move_appointment_atomic','create_appointment_atomic','create_public_booking_atomic','appointment_slot_check') AND a.grantee = 0) THEN
    RAISE EXCEPTION 'FAIL: PUBLIC has a grant';
  END IF;
  RAISE NOTICE 'PASS: A01 before activation no role (PUBLIC/anon/authenticated/service_role) can execute any new function';
END $$;
SELECT t_ok((SELECT bool_and(prosecdef = (proname IN ('move_appointment_atomic','create_appointment_atomic','create_public_booking_atomic')) AND ('search_path=""' = ANY(proconfig) OR 'search_path=' = ANY(proconfig))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('amsterdam_wall_to_utc','minutes_to_wall_time','appointment_busy_candidates','appointment_slot_check','move_appointment_atomic','create_appointment_atomic','create_public_booking_atomic')), 'A02 only the 3 RPCs are SECURITY DEFINER, all 7 pinned to empty search_path');
SELECT t_ok((SELECT count(*)=0 FROM tenant_feature_flags WHERE atomic_agenda_enabled), 'A03 new flag defaults to off for every salon');
BEGIN; SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.move_appointment_atomic('a1000000-0000-0000-0000-000000000001','2026-10-12','11:00',NULL,now());
  RAISE EXCEPTION 'FAIL: owner could call move before activation';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: A04 owner cannot call move before activation';
END $$;
DO $$ BEGIN
  PERFORM public.create_appointment_atomic(NULL,'a0000000-0000-0000-0000-000000000060','2026-10-12','11:00','{}','','manual',NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL: owner could call create before activation';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: A04 owner cannot call create before activation';
END $$;
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM public.create_public_booking_atomic('salon-een','2026-10-16','[]','{}');
  RAISE EXCEPTION 'FAIL: service_role could book before activation';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: A04 server cannot call booking before activation';
END $$;
ROLLBACK;
SELECT t_ok((SELECT count(*)=12 FROM appointments), 'A05 step 1 changed no appointment');
