# Viva ISV onboarding safety (PREPARED, NOT ACTIVE)

Code: `supabase/functions/_shared/inactive/isvOnboardingSafety.ts`. Tests: `tests/viva-isv/isv-onboarding-safety.test.ts`.

## Contract (developer.viva.com, read 2026-10-15)
- VERIFIED: Create `POST /isv/v1/accounts` returns `accountId` + `redirectUrl`; Retrieve `GET /isv/v1/accounts/{accountId}` returns Merchant ID and verification status.
- VERIFIED: webhooks 8193 (Account Connected) and 8194 (Verification Status Changed, Production only) carry `EventData.ConnectedAccountId`, `PersonId`, and `Verified` (8194 only).
- VERIFIED: ISV webhook POSTs have no documented signature (only the GET verification key). So authenticity = Retrieve lookup with ISV credentials.
- UNVERIFIED: exact JSON field names of the Retrieve response (`merchantId`, `verified` assumed). Unknown shape = not verified = no change. Must be confirmed with one demo Retrieve before activation.
- UNVERIFIED: where the merchant source code comes from (not in the onboarding webhooks). The gate keeps requiring it; it is never set from webhooks.

## Activation order (each step needs its own GO; editing an entrypoint auto-deploys it)
1. Confirm the Retrieve field names with one demo account (read-only call).
2. `sync-viva-connected-account`: replace its body with `syncForSession` (ISV token, `/isv/v1/accounts/{id}`, ignore body `user_id`). Deploys that function only.
3. `viva-webhook` lines ~355-392: replace the onboarding block with `handleOnboardingWebhook` (8193/8194 only, MessageId dedupe in `viva_webhook_events`, Retrieve before update). Deploys the merchant webhook, so payment events must be regression-tested first.
4. `_shared/vivaIsv.ts` `requireMerchantContext` / `merchantIsUsable`: use `livePaymentAllowed` (active + kyc verified + merchantId + sourceCode, not demo). Redeploys every function importing it (create-viva-payment, terminal, public-booking, auto-revenue...). Highest blast radius; do after 2-3.
5. `create-viva-connected-account`: `decideCreate` + `parseCreate` (reuse link, read `redirectUrl`). Deploys that function only.
6. Then the wizard UI.

## Known gap
Existing active salons with `onboarding_status=connected` and no `kyc_status=verified` will lose live payments at step 4. Run a count-only check first.
