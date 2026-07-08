## End-to-end audit of €39 Smart Checkout test payment

Read-only investigation across edge function logs and database. No code changes.

### Steps
1. **Identify the payment window.** Query recent rows in `payments`, `subscriptions`, `viva_webhook_events`, and `viva_webhook_debug_logs` (last 30 min) to find the €39 record and its Viva `order_code`/`transaction_id`.
2. **create-viva-payment logs.** Fetch `create-viva-payment` edge function logs; extract `request_context`, `createVivaOrder request` (URL, sourceCode, payload), `createVivaOrder response` (HTTP status + body), returned `orderCode`, and any `viva_order_failed` entries.
3. **saas-checkout-public-viva / saas-subscribe-viva logs.** Since €39 = Starter subscription price, check both SaaS Viva checkout functions for the invocation and returned order code.
4. **viva-webhook logs.** Fetch `viva-webhook` (and related webhook processor) logs to confirm receipt of the Viva notification, matched order code, and DB updates.
5. **Database state.**
   - `payments` row: `status`, `amount`, `viva_order_code`, `viva_transaction_id`, `paid_at`, `updated_at`.
   - `subscriptions` row for the user: `status`, `plan_slug`, `current_period_end`, `viva_*` fields, `updated_at`.
   - `viva_webhook_events`: matching event with `order_code`, `event_type`, `processed_at`.
   - `viva_webhook_debug_logs`: raw payload + processing outcome.
   - `viva_dead_letter_queue`: any failed entries.
6. **Redirect handling.** Look for any post-payment callback function logs (`viva-payment-callback`, `viva-payment-reconcile`, or client-side redirect target) invoked around the same window.
7. **Errors/warnings.** Scan all Viva-related edge function logs for `level: error/warning` in the window.

### Deliverable
Chronological timeline with timestamps for each step (create → Viva → webhook → DB update → subscription activation → redirect), a per-question checkmark answer to items 1-10, the full sanitized Viva request/response, and any anomalies.
