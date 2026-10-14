-- PROPOSED DATA STEP (not applied, separate GO). Run as service role / postgres, AFTER the
-- separation migration and AFTER viva-webhook + create-auto-revenue-payment write via
-- record_platform_commission. Safe to re-run: ON CONFLICT DO NOTHING on (payment_id, kind, provider_reference).
-- Does NOT remove metadata. Removal is a separate file (..._strip.sql) after verification.

-- A. Inventory: aggregates only, no individual rows are returned.
SELECT count(*) FILTER (WHERE metadata ?| ARRAY['platform_fee_cents','glowpay_margin_cents']) AS rows_with_margin_key,
       count(*) FILTER (WHERE paid_at IS NOT NULL AND metadata ?| ARRAY['platform_fee_cents','glowpay_margin_cents']) AS paid_rows_with_margin,
       count(*) FILTER (WHERE paid_at IS NULL AND metadata ?| ARRAY['platform_fee_cents','glowpay_margin_cents']) AS unpaid_rows_with_margin,
       count(*) FILTER (WHERE metadata ?| ARRAY['platform_fee_cents','glowpay_margin_cents']
         AND coalesce(metadata->>'glowpay_margin_cents', metadata->>'platform_fee_cents') !~ '^\d{1,6}$') AS invalid_values
FROM public.payments;

-- B. Copy (only payments where money was actually taken: paid_at set). Invalid values are skipped and counted in A.
INSERT INTO public.platform_commission_entries (payment_id, tenant_id, kind, amount_cents, source, provider_reference, is_demo)
SELECT p.id, p.user_id, 'legacy_margin',
       coalesce(p.metadata->>'glowpay_margin_cents', p.metadata->>'platform_fee_cents')::int,
       'legacy_backfill', '', coalesce(p.is_demo, false)
FROM public.payments p
WHERE p.paid_at IS NOT NULL
  AND coalesce(p.metadata->>'glowpay_margin_cents', p.metadata->>'platform_fee_cents') ~ '^\d{1,6}$'
ON CONFLICT (payment_id, kind, provider_reference) DO NOTHING;

-- C. Verify: run 2026-10-14_isv_commission_verify.sql in the same transaction.

-- Recovery after a partial or wrong run (keeps all metadata, so nothing is lost):
--   DELETE FROM public.platform_commission_entries WHERE source = 'legacy_backfill';  then re-run B + C.
