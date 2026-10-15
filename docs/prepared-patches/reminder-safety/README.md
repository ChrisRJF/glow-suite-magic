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
   Fix: `const w = reminderWindow(now, hoursBefore, WINDOW_MIN, tz)`, query `.gte("appointment_date", w.startIso).lt("appointment_date", w.endIsoExclusive)`
   (bounds are deliberately one day wider), select `start_time`, then filter with `inReminderWindow(w, appt.appointment_date, appt.start_time, tz)`.
   Eligibility compares real UTC instants (now + hoursBefore ± window), so both autumn 02:30 occurrences are distinct.
   Dedup, claims and statuses stay unchanged.

## Storage inconsistency (not guessed)
`appointment_date` is mixed: newer rows hold the real UTC instant, older calendar rows hold the local wall clock written as UTC.
`appointmentStartInstant` uses `start_time` to tell them apart. Legacy rows whose wall time is in the spring gap or the autumn
repeat, and rows where `start_time` matches neither form, get no reminder (fail closed) and should be listed for manual review.
