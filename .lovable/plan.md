## Set VIVA_SOURCE_CODE to "Default" and verify end-to-end

### 1. Update secret
Use `set_secret` for `VIVA_SOURCE_CODE = "Default"`. This is a non-secret value provided inline; `set_secret` overwrites is not available (only `update_secret` does), so fallback path: use `update_secret` to open the secure form with `Default` as placeholder. All other secrets untouched.

### 2. Redeploy affected functions
Redeploy so the new env value is picked up immediately:
- `create-viva-payment`
- `create-auto-revenue-payment`
- `create-payment`
- `saas-checkout-public-viva`
- `saas-subscribe-viva`
- `viva-smart-checkout-health-check` (reads the source_code for reporting)

### 3. Run Smart Checkout health-check
Invoke `viva-smart-checkout-health-check` as the logged-in admin and report `success`, `http_status`, `environment`, `source_code`, and `message`.

### 4. Trigger one live test payment
Since `create-viva-payment` requires an authenticated Lovable Cloud user AND the salon's `viva_status = 'active'`, I cannot silently trigger it from the tool call chain without risking a real Viva order under wrong context. Two options:

- **Preferred:** you click through a test online payment in the app (public booking → deposit, or Kassa → GlowPay). After the click, I fetch `create-viva-payment` edge logs.
- **Alternative:** I invoke `create-viva-payment` directly via the edge-function curl (using your preview session token) with a small €0.30 test amount, `source: "manual"`, and no appointment/customer link so nothing gets written to your booking data. This will fail if the salon is not yet marked active — in that case you get a clear activation-gate error and we know to switch to option 1.

Default: try the alternative first (fast feedback, no user click needed); if it hits the activation gate, ask you to do a click-through.

### 5. Report logs
Fetch `create-viva-payment` edge function logs and paste back the structured entries:
- `stage: "request_context"` (source, payment_type, amount_cents, source_code_env)
- `createVivaOrder stage: "request"` (url, sourceCode, full payload)
- `createVivaOrder stage: "response"` (http_status, viva_body)
- Either the returned `orderCode` (success) OR the `stage: "viva_order_failed"` entry with `viva_status` and `viva_body`.

### Out of scope
- No code changes. Only secret + deploy + observe.
