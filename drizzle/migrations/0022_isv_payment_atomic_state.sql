CREATE TABLE public.isv_payment_orders (
 payment_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, request_key text NOT NULL, merchant_id text NOT NULL,
 state text NOT NULL DEFAULT 'dispatching' CHECK(state IN ('dispatching','ready','held','paid','failed')),
 order_code text UNIQUE, checkout_url text, transaction_id text UNIQUE, failure_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,request_key)
);
GRANT ALL ON public.isv_payment_orders TO service_role;
ALTER TABLE public.isv_payment_orders ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.isv_payment_refunds (
 transaction_id text PRIMARY KEY, payment_id uuid NOT NULL REFERENCES public.isv_payment_orders(payment_id),
 amount_cents integer NOT NULL CHECK(amount_cents>0), fee_cents integer NOT NULL CHECK(fee_cents>=0), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.isv_payment_refunds TO service_role;
ALTER TABLE public.isv_payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.isv_payment_reserve(_payment jsonb,_snapshot jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pid uuid:=(_payment->>'id')::uuid; tid uuid:=(_payment->>'user_id')::uuid; m jsonb:=_payment->'metadata'; cfg jsonb; amt integer; fee integer;
BEGIN
 amt:=(_snapshot->>'amount_cents')::integer;
 IF _snapshot->>'environment'<>'live' OR (_snapshot->>'tenant_id')::uuid<>tid OR (_snapshot->>'payment_id')::uuid<>pid OR amt<=0 OR round((_payment->>'amount')::numeric*100)<>amt THEN RETURN 'error'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.settings WHERE user_id=tid AND coalesce(is_demo,false)=false AND coalesce(demo_mode,false)=false) THEN RETURN 'error'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.glowpay_connected_merchants WHERE user_id=tid AND is_demo=false AND viva_merchant_id=m->>'viva_merchant_id') THEN RETURN 'error'; END IF;
 IF m->>'appointment_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments WHERE id=(m->>'appointment_id')::uuid AND user_id=tid) THEN RETURN 'error'; END IF;
 IF m->>'customer_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=(m->>'customer_id')::uuid AND user_id=tid) THEN RETURN 'error'; END IF;
 cfg:=public.isv_fee_config(tid);
 fee:=least(amt-1,floor((amt::bigint*(cfg->>'online_bps')::int+5000)/10000.0)::int+(cfg->>'online_fixed_cents')::int);
 IF fee<>(_snapshot->>'fee_cents')::int THEN RETURN 'error'; END IF;
 INSERT INTO public.isv_payment_orders(payment_id,tenant_id,request_key,merchant_id) VALUES(pid,tid,m->>'idempotency_key',m->>'viva_merchant_id') ON CONFLICT(tenant_id,request_key) DO NOTHING;
 IF NOT FOUND THEN RETURN 'duplicate'; END IF;
 INSERT INTO public.payments(id,user_id,appointment_id,customer_id,amount,currency,payment_type,status,method,is_demo,provider,viva_merchant_id,viva_source_code,metadata)
 VALUES(pid,tid,(m->>'appointment_id')::uuid,(m->>'customer_id')::uuid,amt/100.0,'EUR',coalesce(m->>'payment_type','deposit'),'pending','viva',false,'viva',m->>'viva_merchant_id','Default',m);
 INSERT INTO public.isv_fee_snapshots(payment_id,tenant_id,channel,environment,amount_cents,fee_cents,bps,fixed_cents)
 VALUES(pid,tid,'online','live',amt,fee,(cfg->>'online_bps')::int,(cfg->>'online_fixed_cents')::int);
 RETURN 'ok';
END $$;
CREATE OR REPLACE FUNCTION public.isv_payment_attach(_payment_id uuid,_order_code text,_checkout_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF _order_code !~ '^[0-9]{10,20}$' OR _checkout_url<>'https://www.vivapayments.com/web/checkout?ref='||_order_code THEN RETURN false; END IF;
 UPDATE public.isv_payment_orders SET order_code=_order_code,checkout_url=_checkout_url,state='ready' WHERE payment_id=_payment_id AND state IN ('dispatching','held') AND order_code IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.payments SET checkout_reference=_order_code,mollie_payment_id=_order_code,metadata=metadata||jsonb_build_object('viva_order_code',_order_code,'checkout_url',_checkout_url) WHERE id=_payment_id;
 RETURN true;
END $$;
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
 IF result='recorded' THEN
 INSERT INTO public.platform_commission_entries(tenant_id,payment_id,provider,provider_transaction_id,kind,amount_cents,currency)
 VALUES(o.tenant_id,_payment_id,'viva',_transaction_id,'payment',s.fee_cents,'EUR');
 END IF;
 ELSE
 cumulative:=s.refunded_amount_cents+_amount_cents;
 returned_fee:=least(s.fee_cents-s.refunded_fee_cents,greatest(0,(CASE WHEN cumulative=s.amount_cents THEN s.fee_cents ELSE floor((s.fee_cents::bigint*cumulative*2+s.amount_cents)/(2.0*s.amount_cents))::int END)-s.refunded_fee_cents));
 INSERT INTO public.isv_payment_refunds(transaction_id,payment_id,amount_cents,fee_cents) VALUES(_transaction_id,_payment_id,_amount_cents,returned_fee);
 UPDATE public.isv_fee_snapshots SET refunded_amount_cents=cumulative,refunded_fee_cents=refunded_fee_cents+returned_fee WHERE payment_id=_payment_id;
 UPDATE public.payments SET refunded_amount=cumulative/100.0,refunded_at=now() WHERE id=_payment_id;
 END IF;
 RETURN CASE WHEN result='duplicate' THEN 'duplicate' ELSE 'ok' END;
END $$;
REVOKE ALL ON FUNCTION public.isv_payment_reserve(jsonb,jsonb),public.isv_payment_attach(uuid,text,text),public.isv_payment_record(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.isv_payment_reserve(jsonb,jsonb),public.isv_payment_attach(uuid,text,text),public.isv_payment_record(uuid,text,text,integer) TO service_role;