CREATE OR REPLACE FUNCTION public.isv_payment_record(_payment_id uuid,_transaction_id text,_kind text,_amount_cents integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o record; s record; result text; cumulative integer; returned_fee integer;
BEGIN
 SELECT * INTO o FROM public.isv_payment_orders WHERE payment_id=_payment_id FOR UPDATE;
 IF NOT FOUND OR o.order_code IS NULL THEN RETURN 'error'; END IF;
 SELECT * INTO s FROM public.isv_fee_snapshots WHERE payment_id=_payment_id FOR UPDATE;
 IF NOT FOUND OR s.environment<>'live' THEN RETURN 'error'; END IF;
 IF _kind='refund' AND EXISTS(SELECT 1 FROM public.isv_payment_refunds WHERE transaction_id=_transaction_id AND payment_id=_payment_id AND amount_cents=_amount_cents) THEN RETURN 'duplicate'; END IF;
 IF _kind='refund' AND (o.state<>'paid' OR s.refunded_amount_cents+_amount_cents>s.amount_cents) THEN RETURN 'error'; END IF;
 result:=public.record_provider_payment(o.tenant_id,_payment_id,'viva',_transaction_id,_kind,_amount_cents,'EUR','webhook');
 IF result NOT IN ('recorded','duplicate') THEN RETURN 'error'; END IF;
 IF _kind='payment' THEN
 UPDATE public.isv_payment_orders SET state='paid',transaction_id=_transaction_id WHERE payment_id=_payment_id;
 UPDATE public.payments SET status='paid',paid_at=coalesce(paid_at,now()),metadata=metadata||jsonb_build_object('viva_transaction_id',_transaction_id,'verified_via','viva_isv_live_api') WHERE id=_payment_id;
 PERFORM public.record_platform_commission(_payment_id,'confirmed',s.fee_cents,'viva_webhook',_transaction_id);
 ELSE
 cumulative:=s.refunded_amount_cents+_amount_cents;
 returned_fee:=least(s.fee_cents-s.refunded_fee_cents,greatest(0,(CASE WHEN cumulative=s.amount_cents THEN s.fee_cents ELSE floor((s.fee_cents::bigint*cumulative*2+s.amount_cents)/(2.0*s.amount_cents))::int END)-s.refunded_fee_cents));
 INSERT INTO public.isv_payment_refunds(transaction_id,payment_id,amount_cents,fee_cents) VALUES(_transaction_id,_payment_id,_amount_cents,returned_fee);
 UPDATE public.isv_fee_snapshots SET refunded_amount_cents=cumulative,refunded_fee_cents=refunded_fee_cents+returned_fee WHERE payment_id=_payment_id;
 UPDATE public.payments SET refunded_amount=cumulative/100.0,refunded_at=now() WHERE id=_payment_id;
 PERFORM public.record_platform_commission(_payment_id,'reversed',returned_fee,'viva_webhook',_transaction_id);
 END IF;
 RETURN CASE WHEN result='duplicate' THEN 'duplicate' ELSE 'ok' END;
END $$;
REVOKE ALL ON FUNCTION public.isv_payment_record(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.isv_payment_record(uuid,text,text,integer) TO service_role;