# Reminder safety (active)

Helpers: `supabase/functions/_shared/reminderSafety.ts`, tests: `src/test/reminder-safety.test.ts`.
Wired into `_shared/sendAppointmentReminder.ts` (tenant-scoped load before dedup/claims) and `whatsapp-reminder-scheduler` (exact-instant window, query bounds widened by one day).
Legacy rows (wall clock stored as UTC) in a DST gap/repeat, or without start_time, are skipped and logged as `reminder_skipped_unresolvable_time` with appointment id and reason only.
