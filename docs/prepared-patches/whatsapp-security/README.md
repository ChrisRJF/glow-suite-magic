# WhatsApp security correction, prepared only

## Activation status: PARTIALLY ACTIVATED 17 October 2026 (owner GO)

Activated in active functions and deployed: `whatsapp-send` authentication
gate (`_shared/whatsappSecurity.ts`, server-derived tenant, role/membership,
customer/recipient/appointment binding, POST-only), scheduler gate
(`_shared/whatsappSchedulerAuth.ts`: scheduled route only via dedicated
server-only `WA_SCHEDULER_CRON_SECRET`, constant-time, fail-closed when unset;
user `{}` probe is no-dispatch; manual test requires owner/manager/admin in
the derived tenant and a tenant-scoped appointment), tenant-scoped retry
reload with date/start-time snapshot verdict (snapshotless legacy rows
suppressed), tenant-scoped review/no-show/dead-letter customer reads, and
appointment snapshots in `sendAppointmentReminder` meta. Production verified:
anonymous POST to both functions returns 401 before any side effect. Job 4
`whatsapp-reminder-every-15min` remains Disabled; the scheduled route stays
inert until the secret is configured and a new job is created under a separate
GO. The prepared-only files below remain as design history; the scheduler
candidate file here was NOT deployed (the active scheduler was patched
directly with a minimal diff instead).

## Inspected call chain

User transport calls: WhatsAppConnectionCard, WhatsAppTemplatesCard, WhatsAppCampaignEditor and WachtlijstPage. Manual reminder: NoShowCenter -> scheduler test_appointment_id -> sendAppointmentReminder. WhatsAppConnectionCard also calls the global scheduler with {} using a user session; that is not a trusted automated identity.

Internal transport calls: public-booking, customer-forms, automation-scheduler, auto-rebook-send, mollie-webhook, viva-webhook, dossierForms, autoRebookPass, sendAppointmentReminder and scheduler retry/review/no-show passes. Existing calls send the server service-role bearer. Their entrypoint authorization is outside this narrow correction; a shared service key establishes internal possession, not origin-specific provenance. Payment callers inspected for call shape only, not modified.

Local config has no explicit JWT configuration for either WhatsApp function. Local migrations define scheduler tables/extensions but contain no current WhatsApp HTTP job registration. A Bearer header alone does not establish a trusted scheduler identity.

### Read-only scheduler evidence, 17 October 2026

- A credential-free projection of `cron.job` confirmed job **4**, `whatsapp-reminder-every-15min`, is **active**, runs `*/15 * * * *`, targets `whatsapp-reminder-scheduler` and uses `pg_net` HTTP POST with an Authorization Bearer header. No raw command or credential was requested or returned.
- The first boolean-only classification query was rejected by the platform's Vault-access protection, even though it did not select any secret. No bypass or credential inspection was attempted. The subsequent reduced query returned only scheduling metadata and booleans. Credential source, validity and privileges remain **unknown**, not proven anonymous and not proven trusted.
- No generated `_shared/cron-auth.ts` / `authenticateCronRequest` helper exists in the local source. Tool discovery did not expose `list_http_schedules` or the structured managed HTTP schedule tools for this project. These observations do not prove that support cannot enable a supported binding, but they prevent a verified managed migration in this session.
- `cron.job` exposes ordinary scheduling columns, not the managed `target_kind`, `target_path` and body/authentication metadata required to classify a managed HTTP callback. Do not treat an ordinary cron row as proof of managed identity.
- Active scheduler creates a service client, then the global branch writes `reminder_scheduler_runs` and acquires its overlap lease without authenticating that branch. The manual `test_appointment_id` branch does verify a user and role. Gateway JWT configuration for these two functions is not explicitly present locally; neither deployed gateway behavior nor legitimate scheduled identity was exercised.

### User-confirmed containment, subsequent preparation

Chris confirms job 4 is **Disabled**. This round accepts that statement, without querying or changing production. The earlier active observation above is historical, not current evidence. Keep job 4 disabled; disabling cron does not authenticate the still-active public endpoint. No further credential investigation is part of this round.

## Prepared corrections

- whatsapp-send.index.ts: POST-only; verified user identity via auth.getUser, or exact existing server service-key comparison using fixed-length SHA-256 digests; server-derived user tenant, role/member checks, optional supplied tenant must match; customer/recipient and appointment/customer/tenant binding. Demo simulation remains before provider credential requirements; templates/log redaction and transport unchanged.
- security.ts reuses existing inactive whatsappSendAuth decision, not the proposed Meta/HMAC/nonce architecture or schema. Membership derivation mirrors existing whatsappSendAdapters. Users with unresolved or multiple active memberships fail closed. Financial-only roles cannot send. Test bypass remains owner/admin only.
- whatsapp-reminder-scheduler.index.ts candidate: review/no-show customer reads and dead-letter customer fallback scoped to salon. Retry appointment reload scoped by salon; compare current customer/date/start time to stored snapshot, reject deleted/cancelled/declined/moved/missing snapshot. Snapshotless old reminders are suppressed rather than guessing or replaying old content.
- sendAppointmentReminder.ts candidate: snapshot is stored after template rendering in meta, overriding caller metadata. No template/body change.
- schedulerAuth.proposal.ts: isolated, executable authentication/route proposal, deliberately NOT imported by the scheduler candidate. Reuses security.ts for verified user identity and salon derivation. With no supported verifier supplied, no automatic route is authorized. User `{}` is an owner/admin/manager no-dispatch probe, never a global sweep. Manual appointment tests check the derived salon and owner/admin/manager permission, including active single-salon memberships. Scheduler authority accepts only `{}` and never the manual-test route. Unknown body fields, including `user_id`, are rejected. OPTIONS remains a side-effect-free wrapper responsibility. Authentication-only reads may precede business-client construction; writes, leases, settings and dispatch must follow the gate.

## Precise remaining limitations

Scheduler candidate retains existing authentication deliberately: changing it without proven cron credentials could break valid scheduling. Therefore it is NOT approved for activation and the existing global scheduler endpoint remains a production risk. The manual branch still uses existing own-account role authorization and tenant-scoped reminder loads; tenant-aware member manual tests require separate validated wiring before activation. The prepared fixes do not prove safety of upstream privileged service callers.

Retry comparisons happen before dispatch, not atomically with provider delivery. A concurrent appointment edit after the check remains possible. Legacy logs without snapshots are blocked. Missing-appointment reminder rows are also blocked in the prepared scheduler. Non-reminder auto-rebook retains its existing separate consent guard.

## Concrete scheduler migration plan, no credentials guessed

1. **Support evidence gate, currently NO-GO.** Ask Lovable support to inspect job 4 server-side and report only its credential classification (managed scheduler identity, verified service identity, anon/publishable token, or unknown), its gateway validation and whether a supported binding and generated verification helper can be made available in this existing project. Do not request the token, raw Authorization header, raw job SQL or secret value. If support cannot establish a trusted binding, stop; no prepared scheduler activation.
2. **Containment already reported by owner.** Keep `whatsapp-reminder-every-15min` (id 4) Disabled. Leave all other jobs unchanged. This preparation performed no job read or write. The one required platform action is: ask Lovable support to provide a supported authenticated HTTP scheduler binding for this existing project, with its server-side verifier/configuration instructions, without exposing the credential. Until supplied and verified, remain NO-GO; do not hand-author HTTP scheduler SQL or invent a replacement secret.
3. **One gate, three routes, after separate GO.** Wire `schedulerAuth.proposal.ts` before the scheduler's existing manual/global branches, supplying only the support-proven verifier. Keep OPTIONS side-effect-free. Reject denied decisions with their status. Return `{success:true, dispatch:false}` for the authenticated user `probe` route without settings reads, logs, leases or sends; the current frontend `{}` call can keep its request shape. For `manual`, pass the gate's `tenantId` and `appointmentId` into the existing shared reminder sender, preserving templates and cooldown. For `scheduled`, continue only to the existing lease/claims/sweep. Construct a business client only after permission succeeds; an authentication-only client may perform auth/role/membership and scoped appointment reads. Missing/wrong credentials return 401; denied route/salon permission returns 403; authenticated unsupported methods return 405. A service transport key is not automatically scheduler authority. Never infer trust from Bearer syntax, a decoded unverified role or body `user_id`.
4. **Internal-service compatibility gate.** Existing service-bearer calls to `whatsapp-send` must keep their call shape, but exact server-key possession and scoped customer/recipient/appointment checks must precede demo logging and provider actions. A shared key does not prove caller-specific authority. Validate each existing upstream entrypoint's authorization and server-derived tenant for public-booking, customer-forms, automation-scheduler, auto-rebook-send, payment webhooks, dossierForms, autoRebookPass and reminder paths before approving transport activation. Inspect payment callers only for this boundary, never change payment logic. Manual transport `test:true` remains owner/admin-only; internal appointment tests use the existing shared reminder test path, not a service `test:true` transport bypass. Preserve templates and demo simulation without provider calls.
5. **Single-run cutover and release evidence.** Disable the old job first, wait for any in-flight request and its existing lease to finish, then deploy only after separate GO. Preserve the existing scheduler lease, canonical reminder claims, cooldown and bounded retry state; do not reset sent rows or retry counters. Never run old and replacement schedules together. Verify anonymous/wrong-token rejection without writes, manual/cross-tenant/internal/demo behavior using isolated fixtures, then observe exactly one real scheduled request with provider sending demonstrably disabled or test-isolated. If a supported non-sending test scope is unavailable, stop rather than run a production sweep. Require authenticated POST success and run evidence without credentials, before enabling one 15-minute schedule. Synthetic tests alone do not establish this proof.
6. **Rollback without replay.** Disable the replacement first and drain in-flight work before restoring any code. Do not re-enable the old insecure job as a fallback; automatic reminders remain paused until its trusted identity is proven. Keep existing claims/logs intact. Never retry a provider-accepted or uncertain send merely because the log write failed; hold unresolved outcomes for reconciliation instead of replaying them. Current code does not prove an uncertainty hold or atomic check-and-deliver guarantee: these are release blockers, not implemented behavior. Prepared stale checks suppress moved/cancelled/deleted/cross-tenant or snapshotless reminders, but a concurrent change after validation remains possible. No rollback or cutover was executed.

## Separate deployment GO checklist

- Support attests the existing or replacement scheduler identity without disclosing it and supplies the supported configuration/helper path.
- Approved isolated code verifies authentication before every dispatch-related side effect; manual appointment tests and the user `{}` probe cannot reach an unrestricted sweep.
- Upstream internal authorization, tenant binding, retry uncertainty and concurrent manual-test cooldown/claim behavior have narrowly scoped executable evidence. Existing prepared tests do not cover all of these release gates.
- Owner separately authorizes required caller/function deployment and scheduling changes; observe one non-sending scheduled run before enabling automatic dispatch.
- Meta Business Verification remains pending and separate from scheduler authentication. No real WhatsApp delivery or Meta-setting change is authorized by this plan. No-show and financial calculation decisions remain outside this work and open for their own approval.

## Narrow preparation test evidence and limits

`src/test/whatsapp-security-prepared.test.ts` exercises existing prepared transport authentication, tenant/recipient binding, manual transport tests, demo simulation and cancelled/deleted/moved/snapshotless retries, plus the isolated scheduler proposal's denied, probe, manual/member and verified-scheduler routes. The scheduler verifier and dispatch are fictional test doubles, NOT evidence of a supported production identity or an actual scheduled run. The proposal is not yet wired into the 817-line scheduler candidate; that integration requires separate GO and its own bounded integration test.

Result in this round: `bunx vitest run src/test/whatsapp-security-prepared.test.ts`, **41/41 passed**. No production requests, sends, deployments or configuration changes. Modified files: this README, the isolated test file; added schedulerAuth.proposal.ts. Existing transport/security/scheduler/shared-reminder candidates were left unchanged.

Manual reminder `test:true` is **not** a dry run: the existing shared sender can send WhatsApp or email, skips the timing window/canonical claim and keeps its 60-second test cooldown. Do not execute it against production to prove this proposal. Preserve existing lease/claims and test cooldown during cutover; do not replay accepted/uncertain sends. Before release, demonstrate non-sending scheduled execution using a supported provider-disabled or isolated test scope. If unavailable, stop. Retry check/delivery races and ambiguous provider acceptance remain explicitly unresolved, not solved by these tests.

## Integration notes after separate GO

- security.ts belongs under functions/_shared/whatsappSecurity.ts. Replace its preparation-only import with ./inactive/whatsappSendAuth.ts. Keep other prepared files at their original corresponding entrypoint/shared destinations.
- Do not replace the existing docs/prepared-patches/whatsapp-send/ proposal: that is a separate, larger Meta gateway rollout.
- No deployment or publication was performed.
