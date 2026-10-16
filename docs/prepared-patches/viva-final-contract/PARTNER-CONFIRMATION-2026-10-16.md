# Focused written-partner contract implementation

Source: written Viva partner confirmation relayed by Chris Francois in the implementation GO on 2026-10-16. No new external audit or provider request was made.

## Confirmed and applied

- LIVE ISV Retrieve Transaction: `GET /checkout/v2/isv/transactions/{transactionId}?merchantId={merchantId}`, LIVE ISV OAuth. `amount` is major EUR (`2.50` => 250 cents). Existing order creation uses minor units (250); charge gate remains false.
- Sale confirmation still requires returned transaction ID, merchant, private bound order, exact amount, currency 978 and status F. Non-numeric, non-finite, unsafe and subcent amounts are rejected rather than rounded into payment evidence.
- Supported registration contract: `POST /isv/v1/webhooks` with existing `url` and `eventTypeId` fields; event set 1796, 1797, 1798, 8193, 8194 prepared. No public listing API exists. Removed unsupported GET and blind POST fallback. Without trustworthy internal subscription evidence, registration returns 409 `registration_evidence_required` before any provider call.
- GET endpoint verification is not POST cryptographic authentication. POST notifications remain untrusted triggers; independent authenticated Retrieve and private server-side order binding are required. No HMAC introduced.
- Existing authoritative Connected Account KYC/acquiring eligibility logic and disabled-charge account refresh remain unchanged.

## Unproven reversal contract

Refund via event 1797 and Retrieve is confirmed conceptually, not its exact response semantics. Sale amount units do not prove refund sign, original transaction field name, or reversal success status. All LIVE 1797 processing is held before lookup or writes with fixed diagnostic `refund_contract_unverified_hold` (503), including synthetic test contract injection. Events remain retryable, not terminal. The older negative amount / `parentId` / F refund logic remains unreachable until a separately reviewed vendor contract correction; no production override exists.

Request from Viva partner: exact LIVE reversal Retrieve response field for original transaction ID, refund amount sign and unit, successful reversal status, and whether order/currency/merchant fields follow the sale response. Obtain a redacted official schema/example, never credentials or customer data.

## Safe manual subscription verification

Ask the Viva partner to confirm the current LIVE ISV account's subscriptions for the configured central callback URL (`ISV_WEBHOOK_URL` in server code), for each event 1796/1797/1798/8193/8194. Obtain dated written evidence identifying present and explicitly missing events for that account and URL, plus previous successful registration receipts if available. Do not press registration again or infer absence from HTTP 405. Only verified missing events can be registered in a subsequent approved evidence-bound operation, with acceptance receipts durably retained. No subscriptions were changed in this pass.

## Separate blockers

- The broken five-minute scheduler remains a separate Lovable Cloud Jobs repair/pause task. Endpoint authorization and scheduler configuration are untouched; no authorized production job or periodic refresh is claimed here.
- Salon KYC/acquiring eligibility and separate owner activation GO remain required. `LIVE_ISV_CHECKOUT_ENABLED=false` is unchanged.
- No real provider orders, charges, refunds, Beautycare data changes, or frontend publication are permitted in this pass.