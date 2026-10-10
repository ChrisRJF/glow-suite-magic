BEGIN;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT 's2:'||(public.move_appointment_atomic('a1000000-0000-0000-0000-000000000007','2026-10-16','10:30','e0000000-0000-0000-0000-00000000000a')->>'code');
COMMIT;
