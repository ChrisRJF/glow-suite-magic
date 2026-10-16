-- PROPOSED, NOT APPLIED. Requires separate GO.
-- Adds two nullable columns to public.settings for onboarding step 2.
-- No defaults, no backfill, no RLS/policy/grant changes: existing rows keep NULL and
-- existing settings policies (tenant-scoped by user_id) already cover these columns.
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS salon_type TEXT;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS salon_logo_url TEXT;

-- After applying: set SETTINGS_SALON_PROFILE_COLUMNS_ENABLED = true in
-- src/lib/onboardingSalonProfile.ts (frontend gate, default false).

-- ROLLBACK (first switch the frontend gate back to false, then, with GO for a destructive change):
-- ALTER TABLE public.settings DROP COLUMN IF EXISTS salon_logo_url;
-- ALTER TABLE public.settings DROP COLUMN IF EXISTS salon_type;
