# Salon vs platform finance separation (PREPARED, NOT ACTIVE)

Migration: `docs/proposed-migrations/2026-10-14_isv_commission_separation.sql` (not applied).
Tests: `tests/viva-isv/run-local-pg-commission.sh` + `commission-separation-tests.sql` (throwaway local Postgres, synthetic data).

## Current access (schema + code only)
- `payments` SELECT/UPDATE: own tenant + `can_view_finance` (eigenaar/admin/financieel etc.); INSERT same; DELETE eigenaar. Whole row incl. `metadata` is readable through the Data API.
- Already today: `viva-webhook` (l.642-669) writes `platform_fee_cents`, `glowpay_margin_cents`, `provider_fee_cents` into `payments.metadata`; `create-auto-revenue-payment` stores `platform_fee_cents` and returns it in its response. So the legacy 0,30 margin is salon-readable now.
- Forgery: finance roles may UPDATE `payments.metadata`; webhook `feeAlreadyStored` trusts those keys, so a salon could pre-set a fee and suppress the margin.
- `viva_settlement_summary` (security_invoker, aggregates `glowpay_margin_cents`): no grant to anon/authenticated, not reachable by salons.
- `payment_ledger`: no app grants, service role only. MCP `revenue-summary` selects only non-platform columns. No UI/export reads platform keys.

## Decision
A filtered view alone is false security: the base table stays readable (proven by test). Chosen: B, separate service-role-only `platform_commission_entries` (append-only: expected, confirmed, reversed, legacy_margin), plus a trigger that blocks salon writes of platform keys in `payments.metadata`. Payments, ledger, refunds and RLS stay unchanged.

## Owner portal (admin.glowsuite.nl)
- Grant: new `platform_owners` table (service role only). Existing `app_role`/`user_roles` are salon roles and are NOT reused; the email allow-list secret is not reused (email is not identity).
- `platform_finance_report(period, tenant)`: SECURITY DEFINER, `auth.uid()` in `platform_owners` AND `aal = aal2`, writes `audit_logs` on every call, returns aggregates only; missing confirmation gives `earned_cents = NULL` + `partially_unconfirmed`, never 0,00.
- Frontend uses the anon key + user session only; no service role key.

## Later changes (each needs GO)
1. Apply migration (tables, trigger, RPC). Inert: nothing writes the new table yet.
2. `viva-webhook` + `create-auto-revenue-payment`: write fees to `platform_commission_entries`, stop writing them to metadata, stop returning `platform_fee_cents` to the browser; `feeAlreadyStored` reads the new table.
3. Data step: backfill legacy keys, then strip them from `payments.metadata`.
4. Add owner `user_id` to `platform_owners` (with MFA enrolled).
5. ISV route (see README.md).

## Review 2026-10-14 (rev 2 of the migration)
Fixed in the proposal (not applied): `search_path = public, pg_temp` on both SECURITY DEFINER functions; new service-role-only `record_platform_commission` (tenant/demo taken from the payment row, amount <= payment, idempotent, conflicting amount raises); `legacy_margin_cents` in the report so old €0,30 margins are visible but never added to ISV earnings; EXECUTE on the trigger function revoked from PUBLIC.
Checked, no change needed: no dynamic SQL (period regex, no injection); no frontend or salon RPC writes platform keys (all writes are service role); report returns aggregates per salon only, owner + aal2, audited.
Known limit: the metadata guard trusts `current_user`; SECURITY DEFINER functions owned by postgres bypass it. None of the current ones copy caller jsonb into payments.metadata; any new one must not.

## Route transition (one deploy per step, each needs GO)
- viva-webhook: on paid, for ISV payments call `record_platform_commission(expected/confirmed)`; for legacy payments call it with `legacy_margin` instead of writing metadata keys. `feeAlreadyStored` = an entry exists (RPC returns 'duplicate'). If the RPC errors: do NOT ack 200; mark the event `processed=false, error=commission_failed`, return 500 so Viva retries.
- Required with that: the duplicate-event shortcut (unique violation -> 200) must only skip events with `processed=true`; today it skips any repeat, so a failed commission would never be retried.
- create-auto-revenue-payment: stop writing `platform_fee_cents` to metadata and stop returning it to the browser; record `expected` via the RPC after the payment row exists.
- No mixed period: deploy the webhook and route change together after the migration; the webhook reads both the entry and the old key during the switch, so a payment created before the switch and paid after still gets exactly one margin.
- Reconciliation query (aggregate): paid payments since the switch without a commission entry must be 0.
- Data: backfill.sql + verify.sql in one transaction, then strip.sql only after verify passes. Recovery: delete source='legacy_backfill' and re-run; metadata stays until strip.
