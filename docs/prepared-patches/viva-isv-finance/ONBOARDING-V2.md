# Viva ISV onboarding v2 (PREPARED, NOT ACTIVE)

Code: `supabase/functions/_shared/inactive/isvOnboardingV2.ts` (builds on `isvOnboardingSafety.ts`). Tests: `tests/viva-isv/isv-onboarding-v2.test.ts`.

## Contract (verified on DEMO 2026-10-15)
- Create: `POST /isv/v1/accounts` { email, returnUrl, branding { partnerName, logoUrl, primaryColor } } -> { accountId, invitation.redirectUrl }.
- Retrieve: `GET /isv/v1/accounts/{id}` -> verified, acquiringEnabled (booleans), merchantId (may be empty), invitation. No sourceCode.
- 8193/8194 ISV webhooks unsigned: hint only, Retrieve decides (existing safety module).

## Rules
- One row per (tenant, ISV env); repeat create reuses the stored Viva https invitation link; missing link = re-read, never a second account; rejected = manual review.
- ISV env (`demo`/`live`) is separate from current payment env; unknown env = no host; rows of the other env are never touched.
- Live payment only if live env + verified + acquiringEnabled + merchantId + confirmed source code.
- Source code is never taken from Viva Retrieve or webhooks; it must be provisioned separately (UNRESOLVED for live).

## Branding
- logoUrl: official GlowPay logo `https://glowsuite.nl/__l5e/assets-v1/b5dafa8b-3daf-4b09-927d-474084acabdc/glowpay-logo.png` (verified public 2026-10-16).
- primaryColor: owner-confirmed `#002448`; separate GlowPay accent `#00C878`, not sent as primaryColor. Official logo retained unchanged. Prepared factory: `_shared/inactive/isvGlowPayBranding.ts`, no active import. GlowSuite theme unchanged.

## Wizard step 3 plan (OnboardingWizard GlowPayStep ~line 485)
- Title "Activeer GlowPay", CTA "Activeer GlowPay via Viva" (opens invitation link; demo shows a note instead, demo cannot follow production onboarding).
- No KYC questions in GlowSuite; Viva handles KYC. "Later doen" keeps the wizard finishable.
- Two separate lines: "Online boeken: actief" and "Betalingen: niet gestart / in behandeling / actie nodig / actief" (`wizardStatus`). No extra form.

## Activation order (each its own GO; editing any entrypoint auto-deploys it)
1. Supply brand hex and live ISV partner credentials (pending at Viva).
2. `sync-viva-connected-account` -> `syncForSession` + `retrieveV2`/`deriveUpdateV2`.
3. `viva-webhook` onboarding block -> `handleOnboardingWebhook` (regression-test payments first).
4. `create-viva-connected-account` -> `decideCreateV2`, `buildCreatePayload`, `parseCreateV2`.
5. `_shared/vivaIsv.ts` gate -> `livePaymentAllowedV2` (redeploys all payment functions; count connected-without-verified first).
6. Wizard step 3 UI, then website publish.

## Separate LIVE ISV config (PREPARED, NOT ACTIVE, 2026-10-16)
- Code: `_shared/inactive/isvLiveConfig.ts`; tests: `tests/viva-isv/isv-live-config.test.ts`.
- Secret names only: `VIVA_ISV_LIVE_CLIENT_ID`, `VIVA_ISV_LIVE_CLIENT_SECRET` (present), `VIVA_ISV_LIVE_ENABLED` (not created; absent = off).
- Never reads `VIVA_ENVIRONMENT`, `VIVA_ISV_CLIENT_*`, merchant or POS credentials (scoped getter).
- Hosts fixed to LIVE: token `accounts.vivapayments.com/connect/token`, API `api.vivapayments.com`.
- Fail closed: switch off, missing credentials, token/Viva failure, unparseable response, demo row, missing brand hex or source code.
- Open create blockers: durable server-only reservation/recovery and LIVE accounts contract/token scope verification. Branding/logo resolved. Source-code provisioning is outside KYC-create scope, not a payment authorization.
- Session-derived user ID must match the supplied row before create/status; no database writes are implemented here. The future adapter must enforce tenant-scoped lookup, atomic create claims and persistence. Ambiguous create outcomes require reconciliation, never automatic retry (otherwise duplicate external accounts are possible).
- LIVE status readiness is not payment authorization. Only sync-viva-connected-account imports isvLiveConfig.ts; this round leaves that module and its existing dependencies unchanged. Contracts remain DEMO-derived, not LIVE-verified.
- The earlier activation list is historical planning, not permission to execute. Credentials are now present; enable switch remains absent/off. No secret was read or changed during preparation.
- 2026-10-16: sync-viva-connected-account now uses syncLiveForSession (LIVE-only, off until VIVA_ISV_LIVE_ENABLED=true; tests tests/viva-isv/isv-live-sync.test.ts). Create, webhook and payment gate remain unchanged.

## Create reservation blocker (catalog-only verification, 2026-10-16)
- Verified `uniq_glowpay_cm_user_demo`: UNIQUE on `public.glowpay_connected_merchants(user_id, is_demo)`. Do not recreate it. It constrains rows, not external POSTs.
- Prepared create has no durable atomic claim; stale/null rows can lead to duplicate POSTs. Catalog checks found no create reservation columns/RPC and own-row INSERT/UPDATE/DELETE policies. Editable metadata or process-local locks are insufficient. No salon/customer rows were read.
- STOP before DB writes/schema changes or entrypoint wiring. Minimal separate migration GO: service-role-only reservation table, UNIQUE `(user_id,is_demo)`, attempt/fencing UUID, state (`reserved`, `dispatching`, `reconciliation_required`, `completed`), timestamps and provider account ID/invitation URL. Explicit service_role grants, RLS, no client access; atomic parameterized claim/dispatch/complete/recover RPCs with service-role-only EXECUTE, fixed search_path and tenant/environment predicates. Existing merchant index unchanged.
- One claim wins; losers return busy or reuse completed result. Persist dispatching before POST. Never automatically expire/retry dispatched or ambiguous attempts. Journal provider result before tenant-scoped merchant persistence. After merchant DB failure, retry only persistence, never POST. If provider success cannot be journaled or the worker crashes, hold the durable dispatch marker for provider-evidence/operator reconciliation. Without verified provider idempotency/authoritative lookup, automatic recovery of a lost account ID is unavailable; no second create allowed.
- Exact next GO: prepare/review this narrow migration plus inactive reservation adapter and fictitious concurrency/crash tests. Applying SQL requires explicit approval. Only afterwards consider one-entrypoint wiring with automatic deployment explicitly scoped; LIVE switch still absent/off. No LIVE requests, frontend activation or payments in this round.
