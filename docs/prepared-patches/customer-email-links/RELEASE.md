# Release: secured customer emails + database stop switch

Replaces the CUSTOMER_EMAIL_PAUSED secret approach (no secret needed). Each step needs explicit approval.

## Files
- Migration: `docs/proposed-migrations/2026-10-10_customer_email_controls.sql`
- Modules (move unchanged from `supabase/functions/_shared/inactive/` to `supabase/functions/_shared/`, then change the imports in the handler from `"../emailTranslations.ts"` to `"./emailTranslations.ts"`): `customerEmailHandler.ts`, `customerEmailTemplates.ts`, `customerEmailRender.ts`, `emailSendAuth.ts`, `emailLinks.ts`
- Function: copy `docs/prepared-patches/customer-email-links/send-white-label-email.index.ts` over `supabase/functions/send-white-label-email/index.ts`
- Remove `src/test/email-template-link-coverage.test.ts` (asserts the old broken links)
- Tests: `src/test/customer-email-handler.test.ts` + 4 existing files (78/78), `bash src/test/sql/run-local-pg-email-stop.sh` (8/8)

## Order
1. Apply the migration. It creates the switch with `sending_enabled = true`. The old function ignores it, so nothing changes yet.
   Check: `select sending_enabled from public.customer_email_controls;` returns `true` (one row).
2. Move the modules, replace the function, deploy only `send-white-label-email`. All nine automatic senders already call with the service key and keep working unchanged.
   Check: owner of a demo salon opens the email template page; preview loads. Edge logs of send-white-label-email show no 401/403/503 from the next real automatic confirmations/reminders (no test booking).
3. Optional, cosmetic: public-booking and automation-scheduler stop sending URL fields (they are ignored already).
4. AdminEmailTemplatesPage: remove the .ics tab content and the calendar_url sample data. Note: platform admins can no longer preview other salons, and "test send" works only to a stored customer of the own salon (owner/admin).

## Stop procedure (no redeploy)
- Stop: `update public.customer_email_controls set sending_enabled = false, reason = '<why>', updated_by = '<who>';`
  Effect on the next request: all customer emails return 503 `email_paused`. Previews keep working. Bookings are unaffected; customers miss emails while stopped.
- Resume: same statement with `true`.
- Missing row or database error also stops sending (fail-closed). Proven in the isolated test.
- Never redeploy the old function as rollback: it reopens unauthenticated sending. Fix forward with the switch off.

## Remaining risk
Shared service-role key: any holder can still send as any salon, but cannot set links. Per-caller keys are a later step.
