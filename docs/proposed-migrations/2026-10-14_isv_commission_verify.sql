DO $$
DECLARE src bigint; dst bigint; src_n bigint; dst_n bigint;
BEGIN
  SELECT coalesce(sum(coalesce(metadata->>'glowpay_margin_cents', metadata->>'platform_fee_cents')::int),0), count(*)
    INTO src, src_n FROM public.payments
   WHERE paid_at IS NOT NULL AND coalesce(metadata->>'glowpay_margin_cents', metadata->>'platform_fee_cents') ~ '^\d{1,6}$';
  SELECT coalesce(sum(e.amount_cents),0), count(*) INTO dst, dst_n
    FROM public.platform_commission_entries e WHERE e.kind = 'legacy_margin';
  IF src <> dst OR src_n <> dst_n THEN
    RAISE EXCEPTION 'backfill_mismatch source=% / % entries=% / %', src, src_n, dst, dst_n;
  END IF;
END $$
