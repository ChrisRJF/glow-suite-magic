-- Synthetic data only. Salon A/B, finance roles simulated via can_view_finance stub.
\set ON_ERROR_STOP 0
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES
 ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000000',10,false,'viva','paid','{}'),
 ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000',20,false,'viva','paid','{}');
INSERT INTO payment_ledger (tenant_id,payment_id,kind,amount_cents,is_demo,created_at) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','payment',1000,false,'2026-10-14'),
 ('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','refund',200,false,'2026-10-15'),
 ('bbbbbbbb-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','payment',2000,false,'2026-10-14');
INSERT INTO platform_commission_entries (payment_id,tenant_id,kind,amount_cents,source,is_demo) VALUES
 ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000000','expected',35,'route',false),
 ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000000','confirmed',35,'viva_webhook',false),
 ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000','expected',35,'route',false);
INSERT INTO platform_owners (user_id) VALUES ('99999999-0000-0000-0000-000000000000');

CREATE OR REPLACE FUNCTION t(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '%: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, name; END $$;
GRANT EXECUTE ON FUNCTION t(text,boolean) TO PUBLIC;
CREATE OR REPLACE FUNCTION denied(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE OR REPLACE FUNCTION raises(sql text, msg text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM = msg; END $$;
GRANT EXECUTE ON FUNCTION denied(text), raises(text,text) TO PUBLIC;

-- Salon A, each salon role (eigenaar/admin/medewerker/financieel) uses the same authenticated DB role.
SET ROLE authenticated;
SELECT set_config('test.uid','aaaaaaaa-0000-0000-0000-000000000000',false), set_config('test.aal','aal1',false);
SELECT t('salon A sees only own payments', (SELECT count(*) FROM payments) = 1 AND (SELECT bool_and(user_id='aaaaaaaa-0000-0000-0000-000000000000') FROM payments));
SELECT t('salon A cannot see salon B', NOT EXISTS (SELECT 1 FROM payments WHERE user_id='bbbbbbbb-0000-0000-0000-000000000000'));
SELECT t('salon roles: commission table denied (direct API)', denied('SELECT * FROM platform_commission_entries'));
SELECT t('salon roles: platform_owners denied', denied('SELECT * FROM platform_owners'));
SELECT t('salon roles: cannot insert commission', denied($q$INSERT INTO platform_commission_entries (payment_id,tenant_id,kind,amount_cents,source,is_demo) VALUES (gen_random_uuid(),gen_random_uuid(),'confirmed',0,'route',false)$q$));
SELECT t('salon payments.metadata carries no commission', NOT EXISTS (SELECT 1 FROM payments WHERE metadata ?| ARRAY['isv_fee_expected_cents','isv_fee_confirmed_cents','platform_fee_cents']));
SELECT t('salon cannot forge platform key on update', raises($q$UPDATE payments SET metadata = metadata || '{"isv_fee_confirmed_cents":0}' $q$, 'platform_field_forbidden'));
SELECT t('salon cannot forge platform key on insert', raises($q$INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',1,false,'viva','pending','{"payment_kind":"isv"}')$q$, 'platform_field_forbidden'));
SELECT t('salon normal payment insert still works', NOT raises($q$INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES ('00000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000000',5,false,'viva','pending','{"note":"x"}')$q$, 'x'));
SELECT t('salon refund status update still works', NOT raises($q$UPDATE payments SET status='partially_refunded', metadata = metadata || '{"note":"r"}' WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, 'x') AND (SELECT status FROM payments WHERE id='00000000-0000-0000-0000-0000000000a1')='partially_refunded');
SELECT t('salon owner: platform report refused', raises($q$SELECT * FROM platform_finance_report('2026-10')$q$, 'not_platform_owner'));
SELECT t('salon owner: tenant id manipulation refused', raises($q$SELECT * FROM platform_finance_report('2026-10','bbbbbbbb-0000-0000-0000-000000000000')$q$, 'not_platform_owner'));
SELECT set_config('test.uid','',false);
SELECT t('anonymous/unknown user refused', raises($q$SELECT * FROM platform_finance_report('2026-10')$q$, 'not_platform_owner'));
SELECT set_config('test.uid','99999999-0000-0000-0000-000000000000',false), set_config('test.aal','aal1',false);
SELECT t('platform owner without MFA refused', raises($q$SELECT * FROM platform_finance_report('2026-10')$q$, 'mfa_required'));
SELECT set_config('test.aal','aal2',false);
SELECT t('owner+MFA: salon A gross/refund/net/earned', (SELECT gross_cents=1000 AND refund_cents=200 AND net_cents=800 AND expected_cents=35 AND confirmed_cents=35 AND earned_cents=35 AND earned_status='confirmed' FROM platform_finance_report('2026-10','aaaaaaaa-0000-0000-0000-000000000000')));
SELECT t('owner+MFA: missing confirmation is NULL, not 0,00', (SELECT earned_cents IS NULL AND unconfirmed_count=1 AND earned_status='partially_unconfirmed' FROM platform_finance_report('2026-10','bbbbbbbb-0000-0000-0000-000000000000')));
SELECT t('owner+MFA: still no direct table access', denied('SELECT * FROM platform_commission_entries'));
RESET ROLE;
SELECT t('every report call is audited', (SELECT count(*) FROM audit_logs WHERE action='platform_finance_report') = 2);
SET ROLE service_role;
SELECT t('service role (webhook) can record commission', NOT raises($q$INSERT INTO platform_commission_entries (payment_id,tenant_id,kind,amount_cents,source,is_demo) VALUES ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000','confirmed',35,'viva_webhook',false)$q$, 'x'));
SELECT t('duplicate commission entry rejected', raises($q$INSERT INTO platform_commission_entries (payment_id,tenant_id,kind,amount_cents,source,is_demo) VALUES ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000','confirmed',35,'viva_webhook',false)$q$, '__any__') IS FALSE AND denied_or_dup());
RESET ROLE;
-- False-security check: a filtered view alone does not help while the base table stays readable.
CREATE VIEW salon_payments_view WITH (security_invoker=true) AS SELECT id,user_id,amount,status FROM payments;
GRANT SELECT ON salon_payments_view TO authenticated;
UPDATE payments SET metadata = metadata || '{"platform_fee_cents":30}' WHERE id='00000000-0000-0000-0000-0000000000b1';
SET ROLE authenticated; SELECT set_config('test.uid','bbbbbbbb-0000-0000-0000-000000000000',false);
SELECT t('view-only approach is false security (base table still leaks legacy key)', EXISTS (SELECT 1 FROM payments WHERE metadata ? 'platform_fee_cents'));
RESET ROLE;
