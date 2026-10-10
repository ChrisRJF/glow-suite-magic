# AGENTS

- Per-tenant feature gates live in public.tenant_feature_flags (read-only for app users, set only by platform admins) and are enforced inside the SECURITY DEFINER RPCs; why: client flags or emails can be spoofed.
- Not-yet-approved edge code lives in supabase/functions/_shared/inactive/ and proposed SQL in docs/proposed-migrations/, never imported by an entrypoint; why: edge function edits deploy automatically.
- The customer email stop switch is the single row in public.customer_email_controls, read fresh on every send and fail-closed; why: a database value takes effect without redeploy, unlike secrets.
