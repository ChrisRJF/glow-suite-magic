# Step 5: ISV demo readiness (PREPARED, NOT ACTIVE)

Module: `supabase/functions/_shared/inactive/isvDemoReadiness.ts`. Test: `tests/viva-isv/isv-demo-readiness.test.ts`.

## Findings
- Order build (`prepareOnlineIsvOrder`): `/checkout/v2/isv/orders?merchantId=…`, body `amount:100, isvAmount:35, sourceCode`. ISV credentials only, no merchant fallback. Correct per Viva ISV docs.
- Earlier order 3159810691703430: the sent body was never stored. isvAmount=35 is NOT proven.
- Event 1799 is not subscribed (`viva-register-webhook-events` defaults are 1796/1797/1798). Active webhook handles 1799 as log-only.
- Active webhook `marginDecision` has no ISV check: a paid ISV payment would get the legacy €0,30 margin too. `isvAwareMarginDecision` prepares the fix.
- No active path records ISV `expected`/`confirmed` commission yet.
- VIVA_WEBHOOK_KEY not set; the webhook trusts only Viva's own transaction lookup (`txVerified`). The 1799 path does no lookup, so a 1799 body must never create a confirmed commission on its own.

## Unknown, depends on Viva
- Which field in 1799 or the transaction holds the final ISV fee, and its unit.
- Whether "Default" source code supports ISV commission.
- Whether a refund reverses the ISV fee automatically.

## Minimal changes before one demo (each needs GO)
1. One temporary demo route (same restrictions as before) that builds the order with `prepareOnlineIsvOrder`, refuses non-ISV targets, writes the payment row first (`metadata.isv=true`, expected fee via `record_platform_commission(expected)`), and logs only `auditOrderBody` + HTTP status + orderCode.
2. Webhook: use `isvAwareMarginDecision`; keep 1799 log-only but store the raw fee fields for manual review.
3. Subscribe 1799 for the demo merchant only.

## Test plan (one payment, €1,00, fee €0,35)
1. Route log shows `isvAmount:35`, endpoint ISV path, HTTP 200, orderCode.
2. Pay in Viva demo checkout.
3. 1796 arrives, lookup verifies, payment = paid, no legacy_margin row.
4. Check reseller view "Bedrag ISV" and whether 1799 arrives with a fee field.
5. Only if Viva confirms: `confirmed` entry of 35 via `confirmedIsvCommission` rules.
6. Salon session cannot read platform_commission_entries (existing tests).
