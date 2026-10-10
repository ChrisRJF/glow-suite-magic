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
- Group bookings from the agenda: each person is stored as its own appointment with
  `booking_group_id` (same model as online groups). The legacy `sub_appointments` table has no time
  or employee per person, so lines without their own time are refused (`group_line_needs_time`).
  The agenda form must send a time per person (patch in `calendarPage.create.patch.md`).
- Before the guard, the current frontend still writes directly (unchanged behaviour until step 3/4).

## Rollout (each step separate written approval)
1. **Schema** `2026-10-10_atomic_appointment_move.sql`: new functions + flag column (default off).
   EXECUTE for nobody (PUBLIC, anon, authenticated, service_role revoked). Refuses to run if
   functions with these names already exist, unless `glowsuite.allow_replace=on` is set after review.
   No existing flow changes. Rollback: drop the new functions and the column.
2. **Online booking**: `..._activate_booking.sql` (EXECUTE to service_role) + deploy patched
   `public-booking` (keep a copy of the current one). The patch answers 503 if the RPC fails; it never
   falls back to the old insert. Rollback before step 4: redeploy the copy and revoke the grant.
3. **Agenda**: `..._activate_agenda.sql` (EXECUTE to authenticated) + publish frontend with the adapter,
   then switch `atomic_agenda_enabled` per salon (platform admin only). Flag off or missing = moves and
   creates blocked with a message (client and server both check). Viewing, notes, cancelling,
   payments stay available. Rollback before step 4: flag off (blocks), or republish previous frontend.
4. **Guard** `2026-10-10_appointment_slot_guard.sql`, only when steps 2 and 3 are live for every salon.
   From then on direct writes of time/employee/links fail for anon, authenticated and service_role.

## Safe rollback after step 4
- Safe to restore: any frontend from step 3 onward, any public-booking with the RPC patch.
- Old frontend republished anyway: viewing works; drag (mouse/touch), "Verplaats afspraak", new
  appointment and waitlist placement fail at the first write (tested G07: nothing changed). Not silent:
  the old code shows its generic error. Avoid; restore a step-3 version instead.
- Old public-booking redeployed anyway: live bookings fail at insert (G06), nothing half-written;
  customers see an error. Payment webhooks and demo seeding keep working.
- Do not drop the guard while an old frontend or old public-booking is live.
- Disabling the flag never re-opens a legacy path: the RPCs return `disabled`, direct writes stay
  blocked by the guard, online booking is not affected by the agenda flag (F05).

## Stap 1 als één transactie (beveiligingsfix)
- Het SQL-bestand bevat bewust geen BEGIN/COMMIT: de Lovable-migratietool (Drizzle) en de Supabase CLI zetten elk migratiebestand al in één transactie. Een eigen COMMIT zou die transactie te vroeg afsluiten.
- Handmatig alleen: `psql -1 -v ON_ERROR_STOP=1 -f 2026-10-10_atomic_appointment_move.sql`.
- Het script weigert te draaien buiten één transactie (transactie-lokale markering) en controleert vóór de commit via `has_function_privilege` en `pg_proc.proacl` dat PUBLIC, anon, authenticated en service_role niets mogen uitvoeren en dat `atomic_agenda_enabled` uit staat. Elke fout draait kolom en functies volledig terug.
