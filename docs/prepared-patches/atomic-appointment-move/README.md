# Atomic appointment move + atomic online booking (prepared, inactive, fase 2)

Status: proposal only. Nothing applied to the database, no Edge Function deployed, nothing in `src/` changed.

## Files
- `docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql`: helpers `amsterdam_wall_to_utc`,
  `appointment_busy_candidates`, `appointment_slot_check`; RPCs `move_appointment_atomic` (v2) and
  `create_public_booking_atomic`.
- `moveAppointmentCore.ts` / `moveAppointmentRpc.ts`: inactive client adapter, fail closed.
- `calendarPage.applyMove.patch.md`: one `applyMove`, legacy path removed.
- `public-booking.create.patch.md`: booking insert through the atomic RPC.
- `tests/atomic-appointment-move/`: `run-local-pg.sh` (throwaway PostgreSQL, socket only, no TCP),
  `fixture.sql`, `tests.sql` (original), `tests-phase2.sql`, race scripts, `adapter.test.ts`
  (`bunx vitest run --config tests/atomic-appointment-move/vitest.config.ts`).

## What is fixed in this version
1. Shared lock. Both RPCs take `pg_advisory_xact_lock('appointment_slot:<tenant>:<local date>')`, then
   re-check with the same `appointment_slot_check` and write inside the same transaction. Booking
   lines of a group are checked and inserted one by one under the lock (each line sees the earlier
   ones); any refusal rolls back all lines and links.
2. Time storage. New writes from both RPCs: `appointment_date` = real UTC, `start_time`/`end_time` =
   Amsterdam wall clock. Reading: a row is `canonical` if its Amsterdam clock equals `start_time`,
   `legacy` if its UTC clock equals `start_time` (old calendar rows), otherwise `ambiguous`.
   Ambiguous rows block both readings; an ambiguous row itself cannot be moved (`ambiguous_time`).
   The DST gap and the repeated hour on the last Sunday of October are refused. No bulk conversion;
   a legacy row becomes canonical only when it is moved.
3. No legacy fallback. Gate off, RPC missing, network error => move blocked with a message.
4. Version required. `_expected_updated_at` has no default; NULL => `missing_version`; compared after
   the row lock and before the no-op check. The RPC returns the stored `updated_at` (after triggers).

## Still open (reason for NO-GO on live)
- **Direct agenda create** (`CalendarPage` inserts) does not take the lock and still writes wall clock
  as UTC. A new agenda appointment can still overlap a parallel online booking or move. Needs its own
  RPC (same pattern) before the lock guarantee is complete.
- Other writers of `appointments` (dossier edit, waitlist conversion, auto-rebook, imports, smart reflow)
  were not reviewed and do not take the lock.
- **Reminders**: scheduler and `sendAppointmentReminder` select by `appointment_date` instant and show
  `start_time`. Legacy calendar rows are 1-2 h off in the 24h/2h window; canonical rows are correct.
  The calendar shows the date via `appointment_date.slice(0,10)`: a canonical row between 00:00 and
  02:00 local shows on the previous day. Read-side fix = `appointmentLocalSlot` (prepared, not used yet).
- RLS still allows salon users a direct `appointments.update`; the RPC is the only path in the prepared
  frontend, not a database-enforced one.
- Not enforced (as today): `max_bookings_simultaneous`, `buffer_minutes`. Multi-employee appointments
  cannot be moved.
- Booking RPC was tested against a fixture with the columns the Edge Function writes; the live table
  may have extra NOT NULL columns or triggers (booking_reference, reminders). Check with schema
  metadata before applying.

## Rollout (each step separate written approval)
1. Schema: apply the migration. Nothing calls it yet; no user impact.
   Rollback: `DROP FUNCTION` of the five new functions (no data involved).
2. Backend: deploy `public-booking` with the RPC patch. Rollback: redeploy the current version
   (keep a copy first, like `docs/prepared-patches/employee-schedule/rollback/`).
3. Frontend: activate the move adapter + gate per tenant in `tenant_feature_flags`.
   Rollback: gate off => moves are BLOCKED (not legacy). Full rollback = republish previous frontend.
4. Before calling the lock guarantee complete: agenda create through an RPC with the same lock.
