# AGENTS (frontend)

- AppLayout compactMobile is opt-in presentation spacing only; why: the mobile agenda can start higher without changing other pages or desktop layout.
- Agenda mobile and desktop date pickers reuse one local renderer with placement-specific open state; why: both date bars stay functional without mounting a second hidden calendar or changing shared calendar styles.
- Dashboard mobile finishing is scoped by data-mobile-dashboard and a mobile-only stylesheet block; why: shared components keep desktop presentation.
- DashboardPage passes its existing tomorrow-risk count to TodayAtAGlance for mobile consolidation only; why: the customer-wide selector and both existing action destinations remain intact without changing desktop metrics.
- Sidebar collapse preferences use the versioned v2 storage key and migrate legacy non-default groups; why: former default-open AI preferences must not override daily-first navigation while deliberate other choices survive.
- Onboarding quick start and extended setup share OnboardingWizard's saveSalon and finish paths; why: one completion path preserves preview isolation, default-service seeding and existing gate flags.
- Onboarding salon_type/logo writes sit behind the gate in lib/onboardingSalonProfile.ts and accept only own salon-logos URLs.
- MFA settings only ever unenroll unverified setups or an explicitly chosen verified factor, and hide removal of a platform owner's final factor (docs/security/platform-owner-mfa.md); why: Supabase Auth cannot block final-factor unenroll server-side.
