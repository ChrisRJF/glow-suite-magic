## Diagnose + fix Viva Smart Checkout `sourceCode`

### Findings from Viva official docs
Source: `https://developer.viva.com/apis-for-payments/payment-api/#tag/Payments` — `POST /checkout/v2/orders`.

- `sourceCode` is **optional**. Docs literal quote: *"sourceCode is case-sensitive. If left unspecified, `Default` source code is used."*
- Sample payload in the docs uses `"sourceCode": "Default"`.
- Sources are merchant-defined via the Self-Care portal (or `POST /api/sources`). Codes can be alphanumeric strings — **not required to be numeric**. Your account's only active source is literally named `Default`, which matches the Viva default.
- There is no public "list sources" GET endpoint documented; sources are only visible in Self-Care or when creating one via `POST /api/sources`.
- Value `1234` is not a magic Viva default — if no source with code `1234` exists on the merchant account, Viva returns HTTP 400 with an error naming the invalid source.

Conclusion: the current secret value `1234` is almost certainly the reason order creation is rejected. Correct value for this account is `Default` (or omit the field to let Viva pick `Default` automatically).

### 1. Add verbose logging to `createVivaOrder` (`supabase/functions/_shared/viva.ts`)
- Before the fetch, emit a structured `console.log` with:
  - `fn: "createVivaOrder"`, `stage: "request"`
  - `url` (`${env.api}/checkout/v2/orders`), `method: "POST"`
  - `sourceCode` (value only), `environment`
  - `payload` (full, minus Authorization header — payload contains no secrets)
- If `sourceCode === "1234"`: extra `console.warn` line: `"Placeholder sourceCode wordt gebruikt."` with `placeholder_source_code: true`.
- After the fetch, log:
  - `fn: "createVivaOrder"`, `stage: "response"`, `http_status`, `viva_body` (full parsed body or raw text on parse fail).
- On error path, throw an `Error` decorated with `.status` and `.body` (mirrors the pattern in `getVivaPosAccessToken`) so callers can surface it.

### 2. Surface the full Viva error to `create-viva-payment`
- Replace the current `console.error("Viva order create failed", e)` with a structured log that includes `e.status` and `e.body`.
- In the 502 JSON response, include `viva_status` and `viva_error` (raw parsed body from Viva). This is only reached in non-demo mode and only contains Viva-side error text (no secrets). The Smart Checkout status card / booking UI already shows the returned error; this makes the exact Viva message visible in the browser toast and in the edge function logs.
- Also log a `stage: "request_context"` line at the top of the try block with `{ user_id, source, payment_type, amount_cents, demoMode:false, has_customer: Boolean(input.customer?.email) }`.

### 3. Do NOT auto-fallback silently
Per user rule "Maak GEEN aannames": do not silently replace `1234` with anything. Instead, produce a clear 400 before hitting Viva when `VIVA_SOURCE_CODE === "1234"`:
- `{ error: "VIVA_SOURCE_CODE is placeholder '1234' — set it to 'Default' or your real Viva Payment Source code, or leave it empty to let Viva pick 'Default' automatically.", requiresSetup: true }`
- Log a matching warn line.

### 4. Allow empty `VIVA_SOURCE_CODE` to fall through to Viva default
- Update `createVivaOrder` to omit `sourceCode` from the payload when the env value is empty/undefined. Per docs, Viva will use `Default` automatically. This makes the app robust for accounts that never customized their source.
- Update `isVivaConfigured()` in `_shared/viva.ts`: keep requiring `VIVA_CLIENT_ID` and `VIVA_CLIENT_SECRET`, but make `VIVA_SOURCE_CODE` optional (previously required). Health-check card already treats it as informational only, so no card change needed beyond that.

### 5. Deploy + verify
1. Deploy `create-viva-payment` and any function importing `_shared/viva.ts` that needs the new logging: `create-viva-payment`, `create-auto-revenue-payment`, `create-payment`, `saas-checkout-public-viva`, `saas-subscribe-viva`.
2. Trigger one real booking test-payment through the public booking flow (or via the Kassa / GlowPay checkout). The user does the click; I fetch the edge function logs for `create-viva-payment` afterwards and paste back:
   - the full request payload (with `sourceCode` value visible)
   - the full Viva HTTP status + response body
3. If the response body confirms `sourceCode` rejection, update `VIVA_SOURCE_CODE` secret to `Default` via `update_secret` and re-test. If it still fails, the logged Viva error will name the exact offending parameter and we adjust from there.

### Out of scope
- No changes to POS/terminal flow, webhooks, Mollie, or database schemas.
- No new UI. Existing Smart Checkout status card is unaffected.
- No hardcoded value substitution — env-driven only.
