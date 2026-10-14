# Viva ISV finance layer (PREPARED, NOT ACTIVE)

Code: `supabase/functions/_shared/inactive/isvFinance.ts` (pure, not imported). Tests: `tests/viva-isv/isv-finance.test.ts`.

## Reused
- `payments`: one row per ISV payment, created before the Viva order (`metadata.payment_kind='isv'`, `isv_channel`, `idempotency_key`, `isv_fee_expected_cents`, `isv_fee_status`); orderCode into `checkout_reference`.
- `payment_ledger` via `record_provider_payment`: single source for gross/refund money.
- `glowpay_connected_merchants`: merchant + source per tenant (server lookup only).
- `viva_webhook_events`: dedupe + log-only for 1799, unknown and unverified events.
- `refund_requests` / `payment_refunds` / `payments.refunded_amount`: refunds unchanged.
- `vivaIsvPrepared.ts`: fees, ISV endpoints, ISV-only credentials.
- `viva_payouts*`: no ISV fields; not used for commission.

## Later changes in active code (each needs GO)
1. New route `create-viva-isv-payment` (pattern of create-viva-payment): tenant from session, `buildIsvPaymentRow`, `findReusable`, ISV order, `applyOrderResult`.
2. `viva-webhook`: branch only for `payment_kind='isv'` through `decideIsvWebhook`; keep existing path for others; money still only via `record_provider_payment` after `txVerified`.
3. `create-viva-terminal-payment`: ISV variant using `/ecr/isv/v1/transactions:sale` + `isvDetails`, channel `terminal`.
4. `create-auto-revenue-payment`: stop pre-setting the 0.30 margin for ISV rows.
5. Tap: no active route exists (marketing copy only). Not built.

## Webhook security finding
Signature is checked only when a header is present and `VIVA_WEBHOOK_KEY` is not set, so authenticity comes only from the Viva API lookup (`txVerified`). Rule: no financial mutation without `txVerified`. ISV webhooks need their own ISV verification key (Viva ISV webhook setup).

## Salon vs platform separation
- Exposure risk: `payments` is readable by the salon via RLS including `metadata`; any `platform_fee_cents`/`isv_fee_*` in metadata is visible to the salon. Before activation: move platform fields out of salon-readable metadata (service-role only storage, e.g. `payment_ledger` columns or a service-role-only column) or serve salons through a view/RPC equal to `toSalonPaymentView`. Current UI shows none of these fields (checked `src/`).
- Platform owner: explicit server-side grant (e.g. `tenant_feature_flags`-style platform-only table or existing platform admin allow-list secret used by send-white-label-email), AND `aal2` (MFA) in the JWT, checked inside SECURITY DEFINER RPCs that log each access to `audit_logs`. Salon roles (`app_role`, incl. eigenaar/admin) never grant access. Separate app on admin.glowsuite.nl; no service-role key in browser.

## Report sources
| Figure | Source |
|---|---|
| Gross, refunds, net, count, per salon/method/day | `payment_ledger` |
| Expected ISV fee | `isv_fee_expected_cents` |
| Confirmed / reversed fee | only Viva-reported values |
| Earned | confirmed minus reversed, with status `partially_unconfirmed` while any are missing |

## Open Viva dependencies
Why isvAmount was not shown on order 3159810691703430; field and unit carrying the confirmed ISV fee (IsvFee?); commission behaviour on refund/reversal; whether `Default` source allows ISV fee; ISV webhook key and 1799 delivery.

## Activation order
1. Viva answers. 2. Hide platform fields from salon reads. 3. Platform-owner RPC + MFA (no UI). 4. Webhook ISV branch (no ISV payments exist yet, so inert). 5. Online ISV route behind flag for one demo tenant. 6. Terminal ISV. 7. Owner portal.
