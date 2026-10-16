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
- logoUrl: existing asset `https://glowsuite.nl/assets/glowsuite-viva-isv-logo.png` (public/assets, published site).
- primaryColor: UNRESOLVED. No GlowPay green exists in the codebase (logo is black/white; app accent is purple). The payload refuses until a real hex is supplied; not invented.

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
- Open blockers: brand hex for `primaryColor`; live source-code provisioning; token scope for ISV accounts unverified on LIVE; logo URL still the older ISV asset (official GlowPay logo needs a public https URL).
- Session-derived user ID must match the supplied row before create/status; no database writes are implemented here. The future adapter must enforce tenant-scoped lookup, atomic create claims and persistence. Ambiguous create outcomes require reconciliation, never automatic retry (otherwise duplicate external accounts are possible).
- LIVE status readiness here is only a prepared check, not a payment-routing activation or permission. No active function imports this module. The account/token contracts remain DEMO-derived, not LIVE-verified.
- The earlier activation list is historical planning, not permission to execute. Credentials are now present; enable switch remains absent/off. No secret was read or changed during preparation.
- 2026-10-16: sync-viva-connected-account now uses syncLiveForSession (LIVE-only, off until VIVA_ISV_LIVE_ENABLED=true; tests tests/viva-isv/isv-live-sync.test.ts). Create, webhook and payment gate remain unchanged.
