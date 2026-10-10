# Activation: customer email links + authorization (INACTIVE, needs approval per patch)

Offline modules (supabase/functions/_shared/inactive/): emailSendAuth.ts, emailLinks.ts,
customerEmailPrepare.ts, customerEmailRender.ts. Tests: src/test/customer-email-{render,links,chain}.test.ts,
src/test/email-send-auth.test.ts (47/47).

Activation means: move the four modules from `_shared/inactive/` to `_shared/` (same file content), then apply patch 1.

## Patch 1: send-white-label-email (first; safe on its own)
1. At the top of the handler: `if (customerEmailPaused(Deno.env.get("CUSTOMER_EMAIL_PAUSED"))) return 503 { error: "email_paused" }` (before any lookup or send).
2. Replace the direct `parsed.data.user_id` trust with `authorizeEmailRequest(req.headers.get("Authorization"), parsed.data.user_id, deps)`:
   - verifyUser = `admin.auth.getUser(jwt)`; tenantForUser = `current_tenant_id()` rule via user_access/user_roles (server read); rolesForUser = user_roles rows for that tenant.
   - Same call for `preview_only` and real sends. 401/403/500 return without render, log or send.
3. Delete `slugify`, `uniqueSalonSlug`, `publicBaseUrl`, `absoluteUrl` fallbacks and the inline `calendarLink`/`termsLink`/`contactUrl`.
4. Build links with `buildSafeEmailLinks({ publicSlug: settings.public_slug, bookingToken, storedReviewUrl })` where `storedReviewUrl` comes from `profiles.google_review_url` of the authorized tenant (never from `settings`; a missing/invalid URL only hides the review button).
   - bookingToken: if `template_data.appointment_id` is given, load `appointments.booking_token` where `id = appointment_id AND user_id = tenant`; otherwise accept `template_data.booking_token` only if an appointment with that token exists for the tenant. No match = no token = no manage/confirm buttons.
5. Render buttons only from `templateActions(template_key, links)`; plain text uses only `allowedLinksIn(...)`. All caller URLs (manage_url, confirm_url, decline_url, calendar_url, receipt_url, membership_url, review_url, rebook_url, booking_url, new_booking_url, contact_url, terms_url, public_base_url, base_url, salon_slug) are ignored.

Effect on current callers (unchanged code): they keep working with the service-role key. Their own subdomain/.ics/appointment-id URLs are ignored, so customers only see valid buttons or no button. Booking confirmations from public-booking get the manage button immediately (it already passes booking_token). Automation-scheduler reminders show no manage button until patch 3.

## Patch 2: public-booking
Remove `calendar_url` and any URL fields from the email payload; pass `appointment_id` and `booking_token`. Cosmetic after patch 1 (the renderer already ignores them).

## Patch 3: automation-scheduler
Remove `publicBaseUrl`, `calendar_url`, `manage_url` (and the appointment-id fallback). Pass `appointment_id` and `booking_token` only when present. Same for the reminder payload in line ~381.

## Patch 4: src/pages/AdminEmailTemplatesPage.tsx
Call send-white-label-email with `preview_only: true` and the user's session (no URLs in template_data) and render the returned html, so the preview equals the real mail. Remove the local `.ics` tab content or show "Agenda-link nog niet beschikbaar". Keep the approved tabs and iframe sandbox unchanged.

## Other templates checked
| Template | Button(s) after patch 1 |
|---|---|
| booking_confirmation | Afspraak beheren (/mijn-afspraak/<token>) or none |
| appointment_reminder | Afspraak beheren + Bevestigen/Annuleren (/afspraak/<token>/bevestigen, /annuleren) or none |
| payment_receipt | Afspraak bekijken if token, else none. /betaalbewijs is a placeholder page and is no longer linked |
| booking_cancellation | Nieuwe afspraak (/boeken/<slug>) or none |
| membership_notification | Abonnement (/abonnementen/<slug>) + Boeken, or none |
| review_request | Stored https google_review_url only, + Boeken |
| auto_rebook | /boeken/<slug> or none |

Callers that keep working unchanged after patch 1 (service key): public-booking, automation-scheduler, sendAppointmentReminder, whatsapp-reminder-scheduler, viva-webhook, mollie-webhook, public-memberships, auto-rebook-send, autoRebookPass.

## Residual risk: shared service-role key
Any holder of the service-role key can still send as any salon. Limits applied: the key no longer controls links (server-only), and it is compared in constant time. Not fixed: per-caller signed keys (later step; all nine callers need changes).

## Safe stop (instead of restoring the old function)
- Step 1: set secret `CUSTOMER_EMAIL_PAUSED=true`. No redeploy. All customer emails stop with 503; no unauthorized or broken-link mail can go out. Booking itself is unaffected; customers miss confirmation emails while paused.
- Step 2: fix forward, redeploy, set the secret back to `false`.
- Never redeploy the old version: it reopens unauthenticated sending.
- Condition: the secret must be created (value `false`) before patch 1 is deployed. Without it, the safe stop is not available: blocker.

## Blockers before production approval
1. Approval to add the `CUSTOMER_EMAIL_PAUSED` secret (value `false`).
2. Confirm the roles allowed to preview and send: eigenaar, admin, manager.
3. Old test src/test/email-template-link-coverage.test.ts already fails (missing `emailStrings`) and asserts the old subdomain/.ics links; remove it together with patch 1.
4. No test booking in production: verify patch 1 with a preview_only request by the owner of a demo salon.

## Update: stop switch and send rights
- CUSTOMER_EMAIL_PAUSED: only the exact value `false` allows sending; `true`, missing or invalid blocks all customer emails. The secret must be set to `false` before patch 1 deploys, otherwise all emails stop.
- Preview: eigenaar, admin, manager (own salon). Manual send: eigenaar, admin only, recipient must be a stored customer of the salon (`recipientAllowed`). Trusted automations (service key) unchanged.
- Unproven: that changing the secret takes effect without a redeploy. The code reads it per request, but platform behaviour for running instances has not been tested. Verify on a non-production function before relying on it.
