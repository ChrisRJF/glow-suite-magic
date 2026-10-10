# Agenda 3.0: one safe way to store appointments (prepared, inactive)

Status: proposal only. Nothing applied, nothing deployed, nothing in `src/` changed.

## Files
- `docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql` (schema step 1):
  helpers `amsterdam_wall_to_utc`, `minutes_to_wall_time`, `appointment_busy_candidates`,
  `appointment_slot_check`; RPCs `move_appointment_atomic`, `create_appointment_atomic`,
  `create_public_booking_atomic`.
- `docs/proposed-migrations/2026-10-10_appointment_slot_guard.sql` (step 4): triggers that stop
  salon users from writing time/employee fields directly.
- `routes-inventory.md`: every write route and its status.
- `moveAppointmentCore.ts`, `moveAppointmentRpc.ts`: inactive client adapter + time/reminder helpers.
- `calendarPage.applyMove.patch.md`, `calendarPage.create.patch.md`, `public-booking.create.patch.md`.
- `tests/atomic-appointment-move/`: `run-local-pg.sh` (throwaway PostgreSQL, socket only),
  `fixture.sql`, `tests.sql`, `tests-phase2.sql`, `tests-phase3.sql`, `tests-guard.sql`, races,
  `adapter.test.ts` (`bunx vitest run --config tests/atomic-appointment-move/vitest.config.ts`).

## Guarantees (tested locally)
- All three write RPCs take the same lock per salon + local day, then check with the same
  `appointment_slot_check` (opening hours, weekly schedule, custom hours, breaks, absence,
  duration, overlaps incl. multi-employee links, unknown employees = salon-wide) and write in one
  transaction. Group lines, sub appointments and employee links: all or nothing.
- Employees only by UUID of the same salon and mode; names never resolved.
- New rows: real UTC + Amsterdam wall clock; end of day stored as `24:00`, slots past closing refused.
- Old rows recognised (wall clock as UTC); unreadable rows block both readings and cannot be moved.
- Move needs `updated_at`; checked after the row lock, before the no-op check.
- Rights: move/create = owner in active mode with eigenaar/admin/manager/receptie; online booking =
  service_role only, salon from slug; helpers not callable by app roles.
- With the guard active, direct writes of date/time/employee/links by salon users fail; notes,
  cancel and payment fields still work; past import rows still allowed.

## Schema comparison with production (structure only, no rows read)
- All columns written by the RPCs exist with compatible types. `settings.user_id` and
  `settings.public_slug` are unique, matching the RPC assumptions.
- Live triggers on `appointments`: `set_booking_reference` (before insert),
  `update_updated_at_column` (before update; RPC returns the stored value),
  `trg_invalidate_reminders_on_reschedule`, `trg_sync_rebook_revenue`, `trg_enqueue_dossier_automation`.
  None blocks the migration; the fixture models the first two.
- Unique `(appointment_id, employee_id)` on links and the exact-start unique index stay; the RPCs
  catch `unique_violation` as conflict.
- `payment_status` default is `none`; the booking RPC writes `unpaid`/`pending` like the Edge Function.
- No CHECK constraints on `appointments.status`/`source`. Table grants could not be read via
  `information_schema` (empty result); verify before step 1.
- Not modelled in the fixture: real RLS policies (a simplified owner policy is used in the guard test).

## Still open
- `seed-demo-data` (service_role, demo only) and any future service_role writer bypass the guard.
- Future-dated import rows are refused by the guard; import of future appointments needs its own RPC.
- Read side (agenda display around midnight, reminders, no-show, confirmations, .ics/e-mail) still
  uses raw `appointment_date` in live code; prepared helpers exist but are not wired in.
- `max_bookings_simultaneous` and `buffer_minutes` are not enforced (as today).
- Multi-employee appointments can be created but not moved (`multi_employee_unsupported`).

## Rollout (each step separate written approval)
1. Schema: apply `2026-10-10_atomic_appointment_move.sql`. Nothing calls it; no user impact.
   Rollback: drop the new functions.
2. Backend: `public-booking` with the RPC patch (keep a copy of the current version first).
   Rollback: redeploy the copy.
3. Frontend: agenda create/move, wachtlijst and read-side helpers on the RPCs, gate per salon in
   `tenant_feature_flags`. Gate off = moves/creates blocked with a message, never the old path.
   Rollback: republish the previous frontend (old direct writes still work until step 4).
4. Guard: apply `2026-10-10_appointment_slot_guard.sql` only after step 3 is live everywhere.
   Rollback: drop the two triggers (no data involved).
