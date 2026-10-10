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

## Activation order
1. Apply the migration (adds a nullable column; nothing changes for existing salons).
2. Publish the frontend. Editor appears; calendar uses hours once a salon sets them.
3. `mv supabase/functions/_shared/inactive/employeeSchedule.ts supabase/functions/_shared/employeeSchedule.ts`,
   update the re-export path in `src/lib/employeeSchedule.ts` and the test import, then copy
   `public-booking.index.ts` over `supabase/functions/public-booking/index.ts` (deploys automatically).
4. Rollback for step 3: restore the previous `public-booking/index.ts`; the booking page falls back to legacy mode automatically.

## Notes
- Appointments without an employee block every employee at that time (conservative, as before).
- Salons without employees keep one salon-wide calendar based on opening hours.
- Old sample-staff appointments (employee_id "Bas" etc.) count as salon-wide blocks after step 3.
