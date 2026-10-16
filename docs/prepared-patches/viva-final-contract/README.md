# Focused final Viva contract review

No deployed code, secrets, merchant/customer rows, provider subscriptions or charge switches were changed. The correction patch is deliberately unapplied because its shared module is imported by active functions. Applying it requires a separate deployment GO.

## Official contract evidence

- https://developer.viva.com/webhooks-for-payments/transaction-payment-created/ documents event 1796 with `EventData.MerchantId`, `OrderCode`, `TransactionId`, `StatusId: F` and `CurrencyCode`.
- https://developer.viva.com/webhooks-for-payments/transaction-reversal-created/ documents event 1797, a signed negative `Amount`, a reversal `TransactionId`, and original transaction `ParentId`. These are webhook fields, not proof of the independent API response schema or units.
- https://developer.viva.com/webhooks-for-payments/setting-up-webhooks/ separates ISV verification/subscription from merchant setup. The owner independently verified Bearer-authenticated GET key retrieval and central ISV subscriptions; research reproduced the ISV section headings but not those subsections' full text. Do not describe this as independently reproduced HTTP-contract proof.
- https://developer.viva.com/code-samples-for-payments/retrieve-transaction/ and https://developer.viva.com/tutorials/payments/verify-a-payment/ document the non-ISV `/checkout/v2/transactions/{id}` endpoint. They do not establish the contract of the current `/checkout/v2/isv/transactions/{transactionId}?merchantId=...` endpoint.

Direct requests to the three owner-provided pages timed out in this environment. Background official-source research retrieved the payment/reversal evidence above. Numeric samples alone were not used to infer amount units.

## Current POST trust model

`viva-webhook` has `verify_jwt=false` and does not validate an inbound JWT, Basic/Bearer credential or cryptographic POST signature. Its optional `viva-signature`/`x-viva-signature`/`x-signature` check is only literal comparison with `VIVA_WEBHOOK_KEY`; missing or mismatching headers do not reject a request. A recorded `signature_valid=true` therefore is not proof of authenticated Viva delivery. No HMAC scheme is documented or introduced here. The GET verification key is an endpoint-ownership handshake, not POST authentication.

LIVE POST events are untrusted triggers. `handleLivePaymentEvent` first checks the hardcoded, default-off checkout gate. When enabled, it reads the private `isv_payment_orders` record and fee snapshot, obtains a LIVE ISV OAuth token, and retrieves the transaction using the stored merchant. Payment confirmation checks provider, non-demo status, tenant ownership, verified merchant, API status `F`, order, amount and EUR currency `978`. A supplied webhook merchant must match; a missing webhook merchant can be accepted because the private merchant and independent response must still match. Webhook `Amount` and `StatusId` do not prove payment. Failed API lookups yield a retry, never paid.

For 1797 the independent response must also contain a negative amount and parent matching the private original transaction. The service-only RPC locks the order/snapshot, deduplicates refunds and rejects over-refunds. Its SQL fee calculation is authoritative; the adapter intentionally does not persist the preliminary TypeScript fee argument.

## Demonstrable correction prepared

`corrections.patch` hardens only the existing transaction parser and adds focused regression tests:

1. Reject null, blank, boolean, numeric-string and nonfinite amounts instead of coercing them with `Number(...)`.
2. Reject unsafe/sub-cent values under the **existing, unproven major-unit assumption**, rather than silently guessing provider rounding. Preserve exact positive and negative cent values, including normal binary floating-point representation noise.
3. Reject a mismatching transaction ID when the response supplies one. Missing response ID remains unresolved, not silently claimed as verified.

The patch does not prove major units, choose a new endpoint, introduce authentication or enable charges. Tests use injected fictitious responses only. The patch includes the regression test at `tests/viva-isv/isv-live-contract.test.ts` for use after approval.

## Test results

- Existing code: 62 selected tests passed across confirmation, payment orchestration, verification key, webhook registration, account refresh and fees.
- Isolated correction: the same 62 plus 22 focused contract-safety tests passed (84 total).
- Regression proof: running the 22 new tests against the original parser produced 9 failures and 13 passes. Failures cover malformed amount coercion, invented sub-cent rounding, unsafe amounts and a mismatching returned transaction ID.
- No provider request or salon data was used. These tests prove local safeguards only, not the unresolved LIVE API contract or authenticated POST delivery.

## Remaining precise LIVE blockers

1. Authoritative API documentation for the **exact ISV retrieve route**, required authentication, sale/reversal response schema, amount units, signed reversal semantics, parent field, returned transaction ID and currency/status representation. The existing `amount * 100` conversion and lowercase/PascalCase fallback remain contract assumptions.
2. Explicit provider amount precision/rounding rules. Internal platform fee half-up rounding is tested but is not evidence of Viva API rounding.
3. Routing still starts from client-writable `payments.metadata.route` in `viva-webhook`, `verify-viva-payment` and reconciliation, before the private order check. Changing that discriminator can suppress secure processing or allow a real ISV row to enter legacy logic. Route selection must be anchored to private order existence across all three paths before LIVE; no unrelated legacy change was made in this review.
4. The outer receiver's `processed` decision incorrectly treats several `*_hold` outcomes as finished because it checks only a `hold_` prefix. Storage errors can also continue without a webhook-ledger row. These require focused retry/routing tests and separately approved deployment before LIVE.
5. Current registration helper subscribes only to 8193/8194. Central LIVE payment subscriptions for 1796/1797/1798 were not verified or changed in this review. The separate `viva-isv-webhook` receiver only logs 1799.
6. Salon KYC/acquiring and explicit final activation GO remain required. No Beautycare lookup or modification was performed, so its current status was not rechecked.

`LIVE_ISV_CHECKOUT_ENABLED` remains `false`. No live webhook/provider/end-to-end transaction was invoked. No public app was published. Credit cost is not visible in the available results.