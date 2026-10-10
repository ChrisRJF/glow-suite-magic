# Atomic appointment move (prepared, inactive)

Status: proposal only. Nothing applied to the database, nothing in `src/` changed.

## Files
- `docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql`: RPC `public.move_appointment_atomic`.
- `moveAppointmentRpc.ts`: inactive client adapter + Dutch messages.
- `calendarPage.applyMove.patch.md`: how `applyMove` in `CalendarPage.tsx` becomes one RPC call.
- `tests/atomic-appointment-move/`: throwaway PostgreSQL fixture + tests (`bash tests/atomic-appointment-move/run-local-pg.sh`).

## What the RPC guarantees (tested locally)
- One transaction: appointment date/start/end, `appointments.employee_id` and the primary
  `appointment_employees` link change together or not at all (simulated link failure test).
- Authorisation = the existing appointments RLS rule (owner, active demo/live mode) plus role
  eigenaar/admin/manager/receptie. medewerker/financieel denied. Unknown and foreign rows both answer `not_found`.
- Employee identified only by UUID of the same salon and mode; inactive, unqualified, absent employees refused.
  Legacy `Medewerker: <naam>` notes are never resolved by name (`legacy_assignment_requires_choice`).
- Same availability rules as public-booking v2 (`employeeSchedule.ts`).
- Amsterdam local time to UTC incl. DST; non-existent local times refused.
- Advisory lock per salon + target day; two overlapping concurrent moves: one wins, one gets `conflict`.
- `SECURITY DEFINER`, `search_path = ''`, all names schema-qualified, EXECUTE only for `authenticated`.

## Known differences / open points (must be reviewed before approval)
1. **Online booking is not serialised with this lock.** public-booking reads availability and inserts
   without a lock; only `idx_appointments_unique_employee_start` (same employee, exact same start)
   protects it. A move and a booking with overlapping but different start times can both succeed.
   Fix needs a separate public-booking change (take the same advisory lock) — not in scope.
2. **Mixed time storage.** The calendar today writes `appointment_date` as `YYYY-MM-DDTHH:MM:00`
   without zone (stored as UTC = wall clock), public-booking writes real UTC. The RPC writes real UTC
   and reads other appointments by `start_time` (wall clock) and the Amsterdam date; within 09:00-18:00
   both conventions give the same date. Reminders for calendar-created appointments are likely 1-2 h off
   today — separate finding, not changed.
3. Busy end time: `end_time`, else service duration, else 30 min (public-booking uses `end_time` or 30).
   Slightly stricter, never looser.
4. Moving to "no employee" only checks opening hours and salon-wide blocks (as today's calendar).
   `max_bookings_simultaneous` and `buffer_minutes` are not enforced (public-booking does not either).
5. Appointments with more than one linked employee are refused (current code would silently delete
   the extra links).
6. Group bookings (`booking_group_id`) are moved per appointment, as today.
7. Staff accounts (non-owner members) cannot move, same as today's RLS.
8. Trigger `trg_invalidate_reminders_on_reschedule` still runs inside the same transaction (DB only, no messages sent).

## Release order (each step needs separate approval)
1. Apply the RPC migration. The live frontend keeps using the old (non-atomic) path; nothing changes for users.
2. Activate the adapter in the frontend behind a feature gate (e.g. `tenant_feature_flags`), for all
   move paths at once: day view, columns, mouse drag, touch drag + sheet confirm, "Verplaats afspraak".
   Same server validation for every path; the client `findConflict` becomes only a quick hint.
3. Rollback = switch the gate off (frontend returns to the old path); the RPC can stay, it has no side effects when unused.
4. Later, separately: public-booking takes the same lock (point 1).
