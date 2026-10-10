-- Throwaway fixture: minimal copy of the live schema parts the proposed RPC uses
-- (column names/types, helper functions and the unique index copied from
-- schema metadata, no data). All rows below are fictional.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT TEMP ON DATABASE gs_move TO authenticated;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TYPE public.app_role AS ENUM ('eigenaar','admin','medewerker','financieel','manager','receptie');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, opening_hours jsonb, is_demo boolean NOT NULL DEFAULT false, demo_mode boolean, public_slug text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, duration_minutes int NOT NULL, price numeric DEFAULT 0, is_demo boolean NOT NULL DEFAULT false);
CREATE TABLE public.employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, working_days int[] NOT NULL DEFAULT '{1,2,3,4,5}', break_start time, break_end time, services jsonb NOT NULL DEFAULT '[]', is_active boolean NOT NULL DEFAULT true, is_demo boolean NOT NULL DEFAULT false, breaks jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'werkzaam', status_from date, status_until date, weekly_schedule jsonb);
CREATE TABLE public.employee_availability_exceptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, employee_id uuid NOT NULL, type text NOT NULL, start_date date NOT NULL, end_date date, start_time time, end_time time, days_of_week int[], is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, customer_id uuid, service_id uuid, appointment_date timestamptz NOT NULL, status text NOT NULL DEFAULT 'gepland', notes text, employee_id text, start_time time, end_time time, booking_group_id uuid, is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  booking_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE, price numeric, payment_status text, payment_required boolean, deposit_amount numeric, source text, payment_type text, accepted_glowsuite_terms boolean, accepted_salon_terms boolean, accepted_terms_at timestamptz);
CREATE TABLE public.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text);
CREATE UNIQUE INDEX idx_appointments_unique_employee_start ON public.appointments (user_id, employee_id, appointment_date) WHERE employee_id IS NOT NULL AND status <> ALL (ARRAY['geannuleerd','cancelled']) AND booking_group_id IS NULL;
CREATE TABLE public.appointment_employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, appointment_id uuid NOT NULL, employee_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false, is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (appointment_id, employee_id));
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_employees ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles)) $$;
CREATE FUNCTION public.current_account_is_demo() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT COALESCE((SELECT s.is_demo OR COALESCE(s.demo_mode, false) FROM public.settings s WHERE s.user_id = auth.uid() ORDER BY s.created_at DESC LIMIT 1), false) $$;
CREATE FUNCTION public.user_row_matches_active_mode(_row_user_id uuid, _row_is_demo boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT auth.uid() = _row_user_id AND COALESCE(_row_is_demo, false) = public.current_account_is_demo() $$;
CREATE FUNCTION public.is_valid_weekly_schedule(_s jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT _s IS NULL OR (jsonb_typeof(_s) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(_s) AS d(k, v)
     WHERE d.k !~ '^[1-7]$' OR jsonb_typeof(d.v) <> 'object'
        OR coalesce(d.v->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR coalesce(d.v->>'end', '')   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR (d.v->>'start') >= (d.v->>'end')))
$$;

-- Test-only switch to simulate a failing link write (rollback test).
CREATE FUNCTION public.t_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('test.fail_link', true) = 'on' THEN RAISE EXCEPTION 'simulated link failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER t_fail_link BEFORE INSERT ON public.appointment_employees FOR EACH ROW EXECUTE FUNCTION public.t_fail_link();

CREATE FUNCTION public.t_ok(cond boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RETURN 'PASS: ' || label; END $$;

-- Fictional tenants/users
-- T1 owner 1111..., T2 owner 2222..., M1 staff member of T1 3333..., T4 owner with only 'financieel' 4444...
INSERT INTO public.user_roles (user_id, role) VALUES
 ('11111111-1111-1111-1111-111111111111','eigenaar'),
 ('22222222-2222-2222-2222-222222222222','eigenaar'),
 ('33333333-3333-3333-3333-333333333333','medewerker'),
 ('44444444-4444-4444-4444-444444444444','financieel');
INSERT INTO public.settings (user_id, opening_hours) VALUES
 ('11111111-1111-1111-1111-111111111111', '{"ma":{"open":"09:00","close":"18:00","enabled":true},"di":{"open":"09:00","close":"18:00","enabled":true},"wo":{"open":"09:00","close":"18:00","enabled":true},"do":{"open":"09:00","close":"18:00","enabled":true},"vr":{"open":"09:00","close":"18:00","enabled":true},"za":{"open":"10:00","close":"16:00","enabled":false},"zo":{"enabled":false}}'),
 ('22222222-2222-2222-2222-222222222222', NULL),
 ('44444444-4444-4444-4444-444444444444', NULL);
INSERT INTO public.services (id, user_id, name, duration_minutes) VALUES
 ('a0000000-0000-0000-0000-000000000060','11111111-1111-1111-1111-111111111111','Knippen',60),
 ('a0000000-0000-0000-0000-0000000000f2','22222222-2222-2222-2222-222222222222','Knippen',60),
 ('a0000000-0000-0000-0000-0000000000f4','44444444-4444-4444-4444-444444444444','Knippen',60);
-- Two employees named Tino with different ids
INSERT INTO public.employees (id, user_id, name, working_days, breaks, weekly_schedule, services, is_active) VALUES
 ('e0000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','Tino','{1,2,3,4,5}','[{"start":"12:00","end":"12:30"}]',NULL,'[]',true),
 ('e0000000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111','Tino','{1,2,3,4,5}','[]','{"1":{"start":"09:00","end":"14:00"},"2":{"start":"09:00","end":"14:00"}}','[]',true),
 ('e0000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','Ina','{1,2,3,4,5}','[]',NULL,'[]',false),
 ('e0000000-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111','Dana','{1,2,3,4,5}','[]',NULL,'["Kleuren"]',true),
 ('e0000000-0000-0000-0000-0000000000f2','22222222-2222-2222-2222-222222222222','Tino','{1,2,3,4,5}','[]',NULL,'[]',true);
UPDATE public.employees SET status='ziek', status_from='2026-10-19', status_until='2026-10-20' WHERE id='e0000000-0000-0000-0000-00000000000a';
INSERT INTO public.employee_availability_exceptions (user_id, employee_id, type, start_date, end_date, start_time, end_time) VALUES
 ('11111111-1111-1111-1111-111111111111','e0000000-0000-0000-0000-00000000000a','custom_hours','2026-10-13',NULL,'13:00','17:00'),
 ('11111111-1111-1111-1111-111111111111','e0000000-0000-0000-0000-00000000000a','vacation','2026-10-14',NULL,NULL,NULL),
 ('11111111-1111-1111-1111-111111111111','e0000000-0000-0000-0000-00000000000a','absent','2026-10-15',NULL,'10:00','11:00');

-- Appointments (UTC instants; Monday 12 Oct 2026 is CEST = UTC+2)
INSERT INTO public.appointments (id, user_id, service_id, appointment_date, start_time, end_time, employee_id, status, notes) VALUES
 ('a1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-12 07:00Z','09:00','10:00','e0000000-0000-0000-0000-00000000000a','gepland',NULL),
 ('a1000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-12 08:00Z','10:00','11:00','e0000000-0000-0000-0000-00000000000b','gepland',NULL),
 ('a1000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-12 14:00Z','16:00','17:00',NULL,'geannuleerd',NULL),
 ('a1000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-16 07:00Z','09:00','10:00',NULL,'gepland','Medewerker: Tino'),
 ('a1000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-16 09:00Z','11:00','12:00',NULL,'gepland',NULL),
 ('a1000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-16 12:00Z','14:00','15:00','e0000000-0000-0000-0000-00000000000a','gepland',NULL),
 ('a1000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-16 14:00Z','16:00','17:00','e0000000-0000-0000-0000-00000000000a','gepland',NULL),
 ('a1000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-12 13:00Z','15:00','16:00','Bas','gepland',NULL),
 ('a2000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','a0000000-0000-0000-0000-0000000000f2','2026-10-12 07:00Z','09:00','10:00',NULL,'gepland',NULL),
 ('a4000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','a0000000-0000-0000-0000-0000000000f4','2026-10-12 07:00Z','09:00','10:00',NULL,'gepland',NULL);
INSERT INTO public.appointment_employees (user_id, appointment_id, employee_id, is_primary) VALUES
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a',true),
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-00000000000b',true),
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-00000000000a',true),
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-00000000000b',false),
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000006','e0000000-0000-0000-0000-00000000000a',true),
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000007','e0000000-0000-0000-0000-00000000000a',true);

-- fase 2 additions (fictional)
UPDATE public.settings SET public_slug='salon-een' WHERE user_id='11111111-1111-1111-1111-111111111111';
UPDATE public.settings SET public_slug='salon-twee' WHERE user_id='22222222-2222-2222-2222-222222222222';
INSERT INTO public.customers (id, user_id, name) VALUES
 ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Test Klant'),
 ('c0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Andere Klant');
-- legacy calendar row (wall clock stored as UTC): Tue 13 Oct 15:00 local, EA
-- and an ambiguous row (start_time matches neither reading): Thu 15 Oct, no employee
INSERT INTO public.appointments (id, user_id, service_id, appointment_date, start_time, end_time, employee_id, status) VALUES
 ('a1000000-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-13 15:00Z','15:00','16:00','e0000000-0000-0000-0000-00000000000a','gepland'),
 ('a1000000-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000060','2026-10-15 05:00Z','14:00','15:00',NULL,'gepland');
INSERT INTO public.appointment_employees (user_id, appointment_id, employee_id, is_primary) VALUES
 ('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-000000000009','e0000000-0000-0000-0000-00000000000a',true);
-- test helper: current version of a row (tests run as authenticated without table grants)
CREATE FUNCTION public.t_upd(uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT updated_at FROM public.appointments WHERE id = $1 $$;
GRANT EXECUTE ON FUNCTION public.t_upd(uuid) TO authenticated;
