# Agenda 3.0 step 2: online booking server (PREPARED, NOT ACTIVE)

Files
- `public-booking.reference.index.ts`: byte-identical copy of the active server (sha256 bff3e770…5d31, test checks it).
- `public-booking.atomic.index.ts`: prepared replacement. It differs only in the save block and the group payment update.
- `publicBookingAtomic.ts`: pure helpers (build RPC args, map result). The tests use this same code.

What changes in `create_booking`
- The second `assertAvailability`, the direct `appointments.insert` and the separate `appointment_employees.insert` are replaced by ONE call: `create_public_booking_atomic(_slug, _date, _lines, _common)`.
- The group payment update uses the `booking_group_id` returned by the database, not one made in the server.
- `booking_reference` is read after the commit (it is set by the existing trigger).
- If the RPC is missing, has no grant, or gives any error, the server answers 503 "Online boeken is even niet beschikbaar". There is never a fallback insert.
- Unchanged: salon lookup, validation, availability, automatic employee choice, customer create/lookup, deposit decision, rebook token check, Mollie/Viva, payments rows, email, WhatsApp, get_booking, lookup_customer.

Activation order (each step needs separate approval)
1. Read-only pre-checks: the 7 functions exist; `has_function_privilege('service_role','public.create_public_booking_atomic(text,text,jsonb,jsonb)','EXECUTE')` is false; every bookable salon has a stored, unique `public_slug` (count only, no salon data shown).
2. Keep `public-booking.reference.index.ts` as the restore copy (sha256 above).
3. Run `2026-10-10_atomic_appointment_activate_booking.sql` (grant to service_role only). Nothing changes for visitors yet.
4. Copy `public-booking.atomic.index.ts` to `supabase/functions/public-booking/index.ts` and `publicBookingAtomic.ts` next to it. This deploys immediately.
5. Verify without bookings: `get_capabilities` gives 2; unknown slug gives 404; GET gives 405; `create_booking` with a past date gives 409 (refused before any write).
6. Check the function logs for `create_public_booking_atomic error`.

Rollback
- New server gives errors and step 4 (slot guard) is NOT applied: restoring the reference copy is technically possible. It brings back the old race (no shared lock). Do this only for a short emergency after a separate decision.
- After step 4 (slot guard) is applied: the old server can no longer save (the guard refuses direct inserts). Do NOT restore it. Instead, revoke the grant (`REVOKE EXECUTE ... FROM service_role`). Online booking then shows "even niet beschikbaar" until a fix is ready.
- Never reapply the reference copy and the grant revoke at the same time without checking which one is live.
