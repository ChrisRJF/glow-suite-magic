# WhatsApp security correction, prepared only

## Activation status: NO-GO

No active Edge Function, secret, scheduler, database or provider setting changed.
Managed Edge Function source edits automatically deploy, so the requested no-deployment boundary requires isolated preparation here. These files are NOT a deployable release as a set: scheduler authentication is unresolved. Do not copy/deploy the scheduler candidate as-is.

## Inspected call chain

User transport calls: WhatsAppConnectionCard, WhatsAppTemplatesCard, WhatsAppCampaignEditor and WachtlijstPage. Manual reminder: NoShowCenter -> scheduler test_appointment_id -> sendAppointmentReminder. WhatsAppConnectionCard also calls the global scheduler with {} using a user session; that is not a trusted automated identity.

Internal transport calls: public-booking, customer-forms, automation-scheduler, auto-rebook-send, mollie-webhook, viva-webhook, dossierForms, autoRebookPass, sendAppointmentReminder and scheduler retry/review/no-show passes. Existing calls send the server service-role bearer. Their entrypoint authorization is outside this narrow correction; a shared service key establishes internal possession, not origin-specific provenance. Payment callers inspected for call shape only, not modified.

Local config has no explicit JWT configuration for either WhatsApp function. Local migrations define scheduler tables/extensions but contain no current WhatsApp HTTP job registration. Previous reported anon-bearer cron is not a trusted scheduler identity; current live binding was deliberately not queried under the no-live-interaction instruction.

## Prepared corrections

- whatsapp-send.index.ts: POST-only; verified user identity via auth.getUser, or exact existing server service-key comparison using fixed-length SHA-256 digests; server-derived user tenant, role/member checks, optional supplied tenant must match; customer/recipient and appointment/customer/tenant binding. Demo simulation remains before provider credential requirements; templates/log redaction and transport unchanged.
- security.ts reuses existing inactive whatsappSendAuth decision, not the proposed Meta/HMAC/nonce architecture or schema. Membership derivation mirrors existing whatsappSendAdapters. Users with unresolved or multiple active memberships fail closed. Financial-only roles cannot send. Test bypass remains owner/admin only.
- whatsapp-reminder-scheduler.index.ts candidate: review/no-show customer reads and dead-letter customer fallback scoped to salon. Retry appointment reload scoped by salon; compare current customer/date/start time to stored snapshot, reject deleted/cancelled/declined/moved/missing snapshot. Snapshotless old reminders are suppressed rather than guessing or replaying old content.
- sendAppointmentReminder.ts candidate: snapshot is stored after template rendering in meta, overriding caller metadata. No template/body change.

## Precise remaining limitations

Scheduler candidate retains existing authentication deliberately: changing it without proven cron credentials could break valid scheduling. Therefore it is NOT approved for activation and the existing global scheduler endpoint remains a production risk. The manual branch still uses existing own-account role authorization and tenant-scoped reminder loads; tenant-aware member manual tests require separate validated wiring before activation. The prepared fixes do not prove safety of upstream privileged service callers.

Retry comparisons happen before dispatch, not atomically with provider delivery. A concurrent appointment edit after the check remains possible. Legacy logs without snapshots are blocked. Missing-appointment reminder rows are also blocked in the prepared scheduler. Non-reminder auto-rebook retains its existing separate consent guard.

## Concrete scheduler migration plan, no credentials guessed

1. Under a separate read-only configuration GO, obtain current job target, body, cadence and authentication classification without retrieving or exposing credential values. Confirm whether this existing project has managed HTTP scheduling and generated cron-auth.ts. Neither capability is evidenced locally.
2. If the existing job is managed, preserve its current credential and use only supported managed scheduler tools and generated verification helper. An unmanaged job cannot be silently migrated. If support is unavailable, pause the old job through Cloud Jobs with separate GO; retain manual appointment-test flow.
3. With separate configuration/deployment GO, configure one supported authenticated replacement callback; never use anon bearer or a body user_id as identity, never introduce a guessed secret, and never put credentials into SQL/code. Make authentication reject anonymous/wrong tokens before any service actions; POST-only. Preserve lease/claims.
4. Activate only after proving the legitimate scheduled request can authenticate. Observe one actual scheduled run with provider sends disabled/test isolated, then retire duplicate/old job. No live send proof is claimed here.

## Integration notes after separate GO

- security.ts belongs under functions/_shared/whatsappSecurity.ts. Replace its preparation-only import with ./inactive/whatsappSendAuth.ts. Keep other prepared files at their original corresponding entrypoint/shared destinations.
- Do not replace the existing docs/prepared-patches/whatsapp-send/ proposal: that is a separate, larger Meta gateway rollout.
- No deployment or publication was performed.
