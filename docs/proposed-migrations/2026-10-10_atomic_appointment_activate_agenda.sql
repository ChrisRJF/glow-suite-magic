-- PROPOSED ACTIVATION, NOT APPLIED. Step 3a (separate approval), together with the frontend.
-- Logged-in users may call the agenda RPCs; inside, the RPCs still require: own salon in active
-- demo/live mode, role eigenaar/admin/manager/receptie and tenant_feature_flags.atomic_agenda_enabled.
GRANT EXECUTE ON FUNCTION public.move_appointment_atomic(uuid, text, text, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_appointment_atomic(uuid, uuid, text, text, uuid[], text, text, uuid, int, jsonb) TO authenticated;
-- Per salon, by a platform admin only:
--   UPDATE public.tenant_feature_flags SET atomic_agenda_enabled = true WHERE tenant_id = '<salon>';
-- Rollback (blocks, never legacy): set the flag false, or REVOKE the two grants.
