# AGENTS

- Per-tenant feature gates live in public.tenant_feature_flags (read-only for app users, set only by platform admins) and are enforced inside the SECURITY DEFINER RPCs; why: client flags or emails can be spoofed.
- Not-yet-approved edge code lives in supabase/functions/_shared/inactive/ and proposed SQL in docs/proposed-migrations/, never imported by an entrypoint; why: edge function edits deploy automatically.
- The customer email stop switch is the single row in public.customer_email_controls, read fresh on every send and fail-closed; why: a database value takes effect without redeploy, unlike secrets.
- Employee availability rules live only in supabase/functions/_shared/inactive/employeeSchedule.ts (re-exported by src/lib/employeeSchedule.ts) and are used by calendar, booking page and public-booking; why: one rule set prevents calendar and online booking from disagreeing.
- Onboarding quick start and extended setup share OnboardingWizard's saveSalon and finish paths; why: one completion path preserves preview isolation, default-service seeding and existing gate flags.
- Sidebar collapse preferences use the versioned v2 storage key and migrate legacy non-default groups; why: former default-open AI preferences must not override daily-first navigation while deliberate other choices survive.
