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
