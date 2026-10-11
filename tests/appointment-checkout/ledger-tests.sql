-- Fictional data only. Run on a throwaway PG after the ledger migration.
\set ON_ERROR_STOP 0
CREATE OR REPLACE FUNCTION t(n text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  RAISE NOTICE '%', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS: '||n ELSE 'FAIL: '||n||' got='||coalesce(got,'null')||' want='||want END; END $$;
INSERT INTO payments VALUES ('d0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111',20.00,true,'viva'),
 ('d0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111',52.00,true,'viva'),
 ('d0000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111',52.00,true,'viva');
SET ROLE service_role;
SELECT t('aanbetaling vastgelegd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000001','viva','tx-dep','payment',2000,'EUR','poll'),'recorded');
SELECT t('replay webhook = duplicate', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000001','viva','tx-dep','payment',2000,'EUR','webhook'),'duplicate');
SELECT t('andere salon geweigerd', record_provider_payment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','d0000000-0000-4000-8000-000000000002','viva','tx-x','payment',5200,'EUR','poll'),'tenant_mismatch');
SELECT t('verkeerd bedrag geweigerd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','tx-rest','payment',5000,'EUR','poll'),'amount_mismatch');
SELECT t('verkeerde valuta geweigerd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','tx-rest','payment',5200,'USD','poll'),'currency_mismatch');
SELECT t('hergebruikte transactie voor andere betaling', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','tx-dep','payment',5200,'EUR','poll'),'conflict');
SELECT t('restbedrag vastgelegd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','tx-rest','payment',5200,'EUR','webhook'),'recorded');
SELECT t('tweede transactie op zelfde betaling', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','tx-rest2','payment',5200,'EUR','poll'),'conflict');
SELECT t('totaal na aanbetaling + rest', (SELECT paid_cents::text FROM appointment_ledger_totals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111')),'7200');
-- payment 3 failed at provider: never recorded; totals unchanged
SELECT t('mislukte betaling wist aanbetaling niet', (SELECT paid_cents::text FROM appointment_ledger_totals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111')),'7200');
SELECT t('refund zonder betaling geweigerd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000003','mollie','re-1','refund',100,'EUR','webhook'),'no_payment');
SELECT t('refund groter dan betaling geweigerd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','re-2','refund',6000,'EUR','webhook'),'amount_mismatch');
SELECT t('deelrefund vastgelegd', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','re-3','refund',1000,'EUR','webhook'),'recorded');
SELECT t('refund replay', record_provider_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-000000000002','viva','re-3','refund',1000,'EUR','poll'),'duplicate');
SELECT t('refundtotaal', (SELECT refunded_cents::text FROM appointment_ledger_totals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111')),'1000');
SELECT t('claim 1', claim_appointment_checkout('k1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111',900)::text,'true');
SELECT t('dubbele claim geweigerd', claim_appointment_checkout('k1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a1111111-1111-4111-8111-111111111111',900)::text,'false');
DO $$ BEGIN INSERT INTO payment_ledger(tenant_id,payment_id,provider,provider_transaction_id,kind,amount_cents,currency,source,is_demo) VALUES (gen_random_uuid(),gen_random_uuid(),'viva','x','payment',1,'EUR','poll','true'); PERFORM t('service_role direct insert geweigerd','allowed','denied');
EXCEPTION WHEN insufficient_privilege THEN PERFORM t('service_role direct insert geweigerd','denied','denied'); END $$;
RESET ROLE;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','sandbox_exec'] LOOP
  PERFORM t(r||' geen tabelrechten', (has_table_privilege(r,'public.payment_ledger','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege(r,'public.appointment_checkout_claims','SELECT,INSERT,UPDATE,DELETE'))::text,'false');
  PERFORM t(r||' geen functierecht', has_function_privilege(r,'public.record_provider_payment(uuid,uuid,text,text,text,integer,text,text)','EXECUTE')::text,'false');
END LOOP; END $$;
SELECT t('service_role alleen SELECT', (has_table_privilege('service_role','public.payment_ledger','INSERT,UPDATE,DELETE,TRUNCATE'))::text,'false');
