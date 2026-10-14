-- PROPOSED DATA STEP (not applied, separate GO). Only after backfill C passed AND both routes
-- write via record_platform_commission. Runs as postgres/service role (guard trigger allows it).
-- Strips platform keys only from paid rows that have a verified legacy entry; unpaid rows keep
-- their keys until they are paid or expire, so no in-flight payment changes behaviour.
UPDATE public.payments p
   SET metadata = p.metadata - ARRAY['platform_fee_cents','glowpay_margin_cents','provider_fee_cents']::text[]
 WHERE p.paid_at IS NOT NULL
   AND p.metadata ?| ARRAY['platform_fee_cents','glowpay_margin_cents','provider_fee_cents']
   AND EXISTS (SELECT 1 FROM public.platform_commission_entries e
                WHERE e.payment_id = p.id AND e.kind = 'legacy_margin');
-- provider_fee_cents is a Viva cost, not GlowSuite income: if it must be kept, copy it to a
-- service-role location first (open point, see SECURITY.md).
