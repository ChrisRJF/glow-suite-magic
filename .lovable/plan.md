## Smart Checkout credentials masked check

Add an admin-only edge function `viva-smart-checkout-credentials-check` that safely exposes masked info about the Smart Checkout OAuth credentials, without ever revealing full values.

### Endpoint
`supabase/functions/viva-smart-checkout-credentials-check/index.ts`

### Auth
- Requires `Authorization: Bearer <user JWT>`
- Only allowed for `eigenaar` or `admin` roles (via `has_role` RPC), same pattern as `viva-source-code-check`.

### Response (JSON)
```json
{
  "VIVA_ENVIRONMENT": "demo",
  "account_endpoint": "https://demo-accounts.vivapayments.com/connect/token",
  "grant_type": "client_credentials",
  "source_code_sent_in_oauth": false,
  "confirmation": "source_code is not sent in OAuth request",
  "VIVA_CLIENT_ID": {
    "present": true,
    "length": 36,
    "first6": "abcdef",
    "last4": "wxyz"
  },
  "VIVA_CLIENT_SECRET": {
    "present": true,
    "length": 44,
    "first4": "abcd",
    "last4": "wxyz"
  },
  "VIVA_SOURCE_CODE": "1234"
}
```

Rules for masking:
- If value is missing: `{ present: false, length: 0 }`.
- If value is too short to safely reveal the requested prefix+suffix without overlap (e.g. client_id < 12 chars, client_secret < 10 chars), return `first*`/`last*` as `null` and add `"too_short": true`.
- `VIVA_SOURCE_CODE` is shown in full (it is a 4-digit merchant source code, not a secret, and the user already saw it fully in the earlier source-code check).

### No changes elsewhere
- Do NOT modify `viva-smart-checkout-health-check`, `_shared/viva.ts`, POS/terminal code, or any payment flow.
- Do NOT add a UI card. This is a one-off diagnostic invoked via the edge function tool.

### After implementation
Invoke the function once as the logged-in admin via the edge-function curl tool and paste the masked JSON back so you can compare the `first6` / `last4` of `VIVA_CLIENT_ID` and `first4` / `last4` of `VIVA_CLIENT_SECRET` against the Smart Checkout credentials shown in the Viva Demo Self-Care portal.
