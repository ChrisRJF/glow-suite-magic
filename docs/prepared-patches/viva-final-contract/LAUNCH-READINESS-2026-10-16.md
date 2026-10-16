# GlowPay launch-readiness: NO-GO

## Proven production results

- Existing `viva-payment-reconcile-every-5min` remains active, schedule every five minutes, with no Authorization marker in its command. Scheduler SQL execution success does not prove HTTP callback success.
- Anonymous production GET and POST: 401. Real scheduler-secret-authorized GET: 405.
- One real, secret-authorized POST: 200, `ok=true`, scanned payments 0, updated payments 0, failures 0. A read-only count established zero eligible non-demo pending Viva payments before invocation.
- Matching production log at 2026-10-16 21:32 UTC: account refresh scanned 1, synced 1, failed 0. This proves a direct account-status refresh, not a repaired recurring job. No customer records were changed and no orders, charges or refunds were initiated.
- No endpoint or scheduler code was changed or deployed. Checkout gate unchanged, default off. No frontend publication.

## Platform limitation and human steps

This existing project has no generated cron-auth helper or exposed supported HTTP-schedule management tools. The available CLI backend actions are read-only; its jobs command manages media jobs, not Cloud cron jobs. No supported agent action to bind credentials or pause this legacy HTTP job was available. No handwritten HTTP scheduler SQL was used.

1. Open Lovable **More > Cloud > Jobs** and select `viva-payment-reconcile-every-5min`. Disable/pause the job if the UI offers that control. Confirm its state is inactive and no new five-minute executions appear. If that control is absent, ask Lovable support to deactivate this exact legacy job; the pause control itself was not browser-verified in this run.
2. For an external scheduler, obtain the deployed `viva-payment-reconcile` invocation URL privately from Cloud function details, or request it from Lovable support. Do not use the drifted custom hooks domain or expose the backend URL in a public report.
3. Configure HTTPS POST every five minutes with JSON body `{}`, `Content-Type: application/json` and `Authorization: Bearer <shared value>`; store the shared value only in the scheduler's encrypted secret store. Turn off request-header/body logging, credentials in URLs, redirects to other origins and overlapping runs.
4. If the existing shared value is not available to the owner, create a strong alphanumeric value of 64 characters in a password manager and edit the existing `VIVA_RECONCILE_CRON_SECRET` in Project Settings > Secrets. Store that identical value privately in the scheduler. Do not use an app-generated non-revealable secret for this shared setup. Do not paste any value into chat. Editing the value invalidates the old one.
5. Confirm the old job is inactive before enabling the replacement. Verify an actual scheduled POST returns 200 and its matching account-refresh log reports successful sync while checkout remains off. Repeat anonymous GET/POST 401 and authorized GET 405. A manual POST alone is not recurring verification.

Every five minutes means 288 runs/day and approximately five minutes maximum scheduling delay, alongside webhook refresh. Frequent checks can increase Cloud costs even when no work exists; disable the broken job first. An external scheduler is a human-configured fallback, not a platform-bound repair performed here.

## Internal subscription evidence

Focused source/docs/migration review found no durable LIVE ISV account + callback + event-bound registration receipts for 1796, 1797, 1798, 8193 or 8194. This does not prove absence at Viva. The helper refuses registration with `registration_evidence_required`; no registration was attempted. Received events and GET verification keys are not registration evidence.

## Exact private Viva support request

Please verify the **current GlowPay LIVE ISV partner account used by this integration**, matched through our existing verified partner-support channel. For the **exact central callback configured as `ISV_WEBHOOK_URL` in the integration**, please provide dated written confirmation separately for **1796, 1797, 1798, 8193 and 8194**: registered or explicitly missing, the bound LIVE account and callback, and any successful registration receipts. We will supply the exact account reference and callback privately through that channel, never credentials or customer data. Please do not create or duplicate subscriptions while investigating. No public listing API exists, so a failed GET cannot establish absence. Only explicitly confirmed missing subscriptions may be considered for a separately approved registration operation with durable acceptance evidence.

For **LIVE ISV reversal Retrieve Transaction**, please supply a redacted official schema/example and confirm:

1. Exact amount field, numeric type, sign (negative or positive), currency unit (major EUR or minor cents), decimal precision and rounding rules for full and partial reversals.
2. Exact field name and meaning for the original sale transaction ID, reversal transaction ID, merchant ID, order code and currency. Is the original-ID field actually `parentId`, and which ID must be used in Retrieve?
3. Exact successful, pending and failed reversal statuses. Does `F` establish a completed reversal, or only a sale?
4. Exact LIVE ISV meaning and payload contract for 1797 and 1798: reversal-created versus failed, payment failure versus reversal failure, and whether these events imply final state. Confirm how to distinguish refund, void/cancellation and any other reversal type.
5. Whether the confirmed sale Retrieve endpoint and its merchant query parameter apply unchanged to reversals, and whether order/merchant/currency bindings retain sale semantics.

GET verification is not POST cryptographic authentication. No HMAC is inferred; independent authenticated Retrieve and private order binding remain mandatory. Event 1797 remains held before lookup/writes.

## First LIVE test: preparation only

The confirmed sale endpoint and major-EUR parser are ready in code; 2.50 maps to 250 cents with strict ID/merchant/order/amount/currency/status checks. No new synthetic test cycle was run because executable code did not change.

A test checklist can be prepared, but no executable LIVE order may be created now. Prerequisites: proven recurring refresh, verified subscriptions, complete reversal contract and safe cleanup path, authoritative salon KYC/acquiring eligibility, privately checked merchant/source mapping and an agreed owner-funded amount. Only after these are evidenced may the owner give separate explicit approval for activation and the first real payment. Beautycare/customer data must remain outside scope unless separately authorized. The first payment must later be independently retrieved, privately bound and read back from authoritative payment evidence before success is claimed.