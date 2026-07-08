## Update Smart Checkout OAuth credentials and verify

### 1. Update secrets
Call `update_secret` for `VIVA_CLIENT_ID` and `VIVA_CLIENT_SECRET`. This opens a secure form where you paste the values yourself — safer than accepting them inline. Leave `VIVA_ENVIRONMENT`, `VIVA_SOURCE_CODE`, and all `VIVA_POS_*` secrets untouched.

Values to paste in the form:
- `VIVA_CLIENT_ID` = `cwb07bc9sb4lc3gc7wps54vflm4qax6hvzslu8osur8e9.apps.vivapayments.com`
- `VIVA_CLIENT_SECRET` = `Aa362Nm29r3U2Rm36kj9zJGPj739gD`

### 2. Redeploy affected edge functions
Redeploy the functions that read these secrets so the new env vars are picked up immediately:
- `viva-smart-checkout-health-check`
- `viva-smart-checkout-credentials-check`

(Other Viva functions will pick up new env on their next cold start automatically.)

### 3. Run health check
Invoke `viva-smart-checkout-health-check` as the logged-in admin and report:
- `success`
- `credential_valid`
- `http_status`
- `environment`
- `account_host` (OAuth endpoint = `${account_host}/connect/token`)
- `message`
- `viva_error` body if any

### 4. Confirm UI status
Report whether the "Smart Checkout status" card in Settings → GlowPay should now show the green "verbonden" badge (based on the health-check result).

### 5. Online payment smoke test (read-only observation)
No new payment will be triggered by me (that would create a real Viva order). Instead, I will confirm end-to-end readiness by checking that `create-viva-payment` uses the same shared `getVivaAccessToken()` helper and that the health-check just proved token issuance works. If you want an actual test payment created, say so and I will invoke `create-viva-payment` with a small test amount.

### Out of scope
- No changes to POS/terminal logic, webhook handlers, payment flow code, or database.
- No changes to `VIVA_SOURCE_CODE` (still `1234` — separate follow-up if that needs updating).
