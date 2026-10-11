-- PROPOSED ONLY (step 3A). NOT applied, NOT tested against PostgreSQL yet. Needs separate approval.
-- Purpose: let the server route call the existing create logic for the RESOLVED tenant without
-- granting EXECUTE to authenticated, and make retries idempotent.
--
-- 1. Idempotency store for the route (service_role only).
CREATE TABLE IF NOT EXISTS public.agenda_create_requests (
  tenant_id   uuid NOT NULL,
  request_id  uuid NOT NULL,
  body_hash   text NOT NULL,
  state       text NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress','done')),
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id)
);
GRANT ALL ON public.agenda_create_requests TO service_role;
ALTER TABLE public.agenda_create_requests ENABLE ROW LEVEL SECURITY; -- no policies: app users have no access

-- 2. Wrapper executed only by service_role. Required change in create_appointment_atomic:
--    move its body into public.create_appointment_atomic_core(_actor uuid, _tenant uuid, ...)
--    where every use of auth.uid() as TENANT becomes _tenant (customers, services, employees,
--    tenant_feature_flags lookup, inserts) and the role check uses has_any_role(_actor, ...)
--    plus a check that _actor belongs to _tenant (same rule as current_tenant_id()).
--    The existing create_appointment_atomic then becomes a thin call with (auth.uid(), current_tenant_id()).
--    _source stays restricted to ('manual','waitlist'). Demo mode must come from the tenant, not
--    current_account_is_demo() (which reads the caller session).
-- CREATE OR REPLACE FUNCTION public.create_appointment_atomic_as(_actor uuid, _tenant uuid, ...) ... SECURITY DEFINER ...
-- REVOKE ALL ON FUNCTION public.create_appointment_atomic_as(...) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.create_appointment_atomic_as(...) TO service_role;
--
-- Rollback: REVOKE the grant; table can stay (no app reads it). Existing appointments are untouched.
