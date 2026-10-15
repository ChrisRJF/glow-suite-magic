# Reminder safety (prepared, not active)

Helpers: `supabase/functions/_shared/inactive/reminderSafety.ts`, tests: `src/test/reminder-safety.test.ts`.

Not wired in, because editing the live reminder functions deploys them automatically.

## Wiring after a separate GO
1. `_shared/sendAppointmentReminder.ts`: replace the separate appointment, customer and service lookups with
   `loadTenantScopedReminderRows(admin, userId, appointmentId, <appt select>, <customer select>)`, placed before
   `reminderAlreadySent` / `claimReminderDispatch`. If `!ok`, return `{ status: "skipped", channel: null, reason }`.
   Today the customer and service lookups filter only on `id`, not on `user_id`.
2. `whatsapp-reminder-scheduler/index.ts` (reminder pass):
   - Bug A: the query uses `${date}T00:00:00Z..T23:59:59Z` (UTC day), so near local midnight appointments are missed.
   - Bug B: `appointment_date.slice(0, 10)` reads the UTC date, not the salon date.
   - Bug C: local `addMinutesLocal` applies the offset with the wrong sign (summer: 4h off).
   Fix: `const w = reminderWindow(now, hoursBefore, WINDOW_MIN, tz)`, query `.gte("appointment_date", w.startIso).lt("appointment_date", w.endIsoExclusive)`, filter with `inReminderWindow(w, appt.appointment_date, startTime, tz)`.
   Dedup, claims and statuses stay unchanged.
