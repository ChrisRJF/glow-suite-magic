# Werktijden per medewerker

One availability rule set (`supabase/functions/_shared/inactive/employeeSchedule.ts`) is used by the
internal calendar (via `src/lib/employeeSchedule.ts`), the public booking page and the server patch.

## Files
- `docs/proposed-migrations/2026-10-10_employee_weekly_schedule.sql` — `employees.weekly_schedule` (NULL default, no row updates) + validity CHECK.
- `supabase/functions/_shared/inactive/employeeSchedule.ts` — rules: weekly hours or legacy working days, opening hours, breaks, sick/vacation/exceptions, existing appointments, Amsterdam time (DST), `resolveBooking` for server-side checks incl. group and automatic choice.
- `src/pages/EmployeesPage.tsx` — weekly editor; hidden until the column exists.
- `src/pages/CalendarPage.tsx` — respects weekly hours when set; unchanged otherwise.
- `src/pages/BookingPage.tsx` — real staff + server slots only when the server answers `availability_version: 2`; otherwise legacy behaviour.
- `docs/prepared-patches/employee-schedule/public-booking.index.ts` (+ `.diff`) — replacement for `supabase/functions/public-booking/index.ts`.
- `src/test/employee-schedule.test.ts` — 27 tests, fictional staff.

## Activation order (no moment where hours are visible but not enforced)
1. Apply the migration (nullable column + validity check; no rows change). Editor stays hidden: the app
   also requires the server to answer `get_capabilities` with `availability_version: 2`.
2. `mv supabase/functions/_shared/inactive/employeeSchedule.ts supabase/functions/_shared/employeeSchedule.ts`,
   update the re-export in `src/lib/employeeSchedule.ts` and test imports, copy `public-booking.index.ts`
   over `supabase/functions/public-booking/index.ts` (deploys). From now on the server enforces hours.
   Visitors with an old page open: automatic choice keeps working; a sample name such as "Bas" is
   refused with 409 `booking_page_outdated` ("vernieuw de pagina"), never reassigned silently.
3. Publish the frontend. The editor appears only now (column + server capability both present).
Fallback for step 2: restore the previous `public-booking/index.ts`; the editor hides itself again
(capability missing) and the booking page falls back to legacy mode. Saved schedules stay stored, unused.

## Confirmation email (prepared call only)
The patch no longer builds the non-existent `.ics` subdomain link, passes `appointment_id` and
`booking_token`, sends the employee name instead of an id, and a valid `https://glowsuite.nl/mijn-afspraak/<token>` manage link.
NOT solved: the live `send-white-label-email` renderer still has its own invalid fallbacks
(salon subdomain base URL, `/afspraak/beheer`, terms/contact links). Those are fixed only by the separate
prepared email patch (`docs/prepared-patches/customer-email-links/`).

## Notes
- Appointments without an employee block every employee at that time (conservative, as before).
- Salons without employees keep one salon-wide calendar based on opening hours.
- Appointments with sample names ("Bas"), deleted or missing employee ids block the whole salon (`normalizeBusyEmployees`).
- Throwaway DB test: `src/test/sql/run-local-pg-employee-schedule.sh`.
