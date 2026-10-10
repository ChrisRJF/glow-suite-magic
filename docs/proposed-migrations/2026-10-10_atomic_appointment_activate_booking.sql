-- PROPOSED ACTIVATION, NOT APPLIED. Step 2a (separate approval), together with the
-- public-booking deploy. Only the trusted server role used by Edge Functions.
GRANT EXECUTE ON FUNCTION public.create_public_booking_atomic(text, text, jsonb, jsonb) TO service_role;
-- Rollback: REVOKE EXECUTE ON FUNCTION public.create_public_booking_atomic(text, text, jsonb, jsonb) FROM service_role;
--   (the patched public-booking then answers 503 "Online boeken is even niet beschikbaar"; no unsafe fallback)
