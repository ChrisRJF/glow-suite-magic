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
UPDATE payments SET status='partially_refunded', metadata = metadata || '{"note":"r"}' WHERE id='00000000-0000-0000-0000-0000000000a1';
SELECT t('salon refund status update still works', (SELECT status FROM payments WHERE id='00000000-0000-0000-0000-0000000000a1')='partially_refunded');
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
DO $$ BEGIN
  INSERT INTO platform_commission_entries (payment_id,tenant_id,kind,amount_cents,source,is_demo) VALUES ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000','confirmed',35,'viva_webhook',false);
  PERFORM t('duplicate commission entry rejected', false);
EXCEPTION WHEN unique_violation THEN PERFORM t('duplicate commission entry rejected', true); END $$;
RESET ROLE;
-- False-security check: a filtered view alone does not help while the base table stays readable.
CREATE VIEW salon_payments_view WITH (security_invoker=true) AS SELECT id,user_id,amount,status FROM payments;
GRANT SELECT ON salon_payments_view TO authenticated;
UPDATE payments SET metadata = metadata || '{"platform_fee_cents":30}' WHERE id='00000000-0000-0000-0000-0000000000b1';
SET ROLE authenticated; SELECT set_config('test.uid','bbbbbbbb-0000-0000-0000-000000000000',false);
SELECT t('view-only approach is false security (base table still leaks legacy key)', EXISTS (SELECT 1 FROM payments WHERE metadata ? 'platform_fee_cents'));
RESET ROLE;

-- ===== Review round 2026-10-14: additional risks =====
-- PostgREST exposure (privileges are what PostgREST enforces).
SELECT t('PostgREST: anon/authenticated have no table privilege on commission/owners', NOT (
  has_table_privilege('anon','platform_commission_entries','SELECT,INSERT,UPDATE,DELETE') OR
  has_table_privilege('authenticated','platform_commission_entries','SELECT,INSERT,UPDATE,DELETE') OR
  has_table_privilege('anon','platform_owners','SELECT,INSERT,UPDATE,DELETE') OR
  has_table_privilege('authenticated','platform_owners','SELECT,INSERT,UPDATE,DELETE')));
SELECT t('RPC: anon cannot execute platform report', NOT has_function_privilege('anon','platform_finance_report(text,uuid)','EXECUTE'));
SELECT t('RPC: anon/authenticated cannot execute record_platform_commission', NOT (
  has_function_privilege('anon','record_platform_commission(uuid,text,integer,text,text)','EXECUTE') OR
  has_function_privilege('authenticated','record_platform_commission(uuid,text,integer,text,text)','EXECUTE')));
SELECT t('SECURITY DEFINER functions pin search_path incl. pg_temp', (SELECT bool_and(array_to_string(proconfig,',') LIKE '%search_path=public, pg_temp%') FROM pg_proc WHERE proname IN ('platform_finance_report','record_platform_commission')));

SET ROLE authenticated; SELECT set_config('test.uid','bbbbbbbb-0000-0000-0000-000000000000',false);
SELECT t('salon cannot call record_platform_commission', denied($q$SELECT record_platform_commission('00000000-0000-0000-0000-0000000000b1','confirmed',0,'viva_webhook','x')$q$));
SELECT t('salon cannot update commission', denied('UPDATE platform_commission_entries SET amount_cents = 0'));
SELECT t('salon cannot delete commission', denied('DELETE FROM platform_commission_entries'));
SELECT t('salon cannot remove legacy margin key', raises($q$UPDATE payments SET metadata = metadata - 'platform_fee_cents'$q$, 'platform_field_forbidden'));
SELECT t('salon cannot wipe metadata wholesale', raises($q$UPDATE payments SET metadata = '{}'$q$, 'platform_field_forbidden'));
SELECT t('salon refund during transition (key untouched) still works', NOT raises($q$UPDATE payments SET status='refunded', metadata = metadata || '{"reversal_reason":"manual"}' WHERE id='00000000-0000-0000-0000-0000000000b1'$q$, 'x'));
SELECT set_config('test.uid','cccccccc-0000-0000-0000-000000000000',false), set_config('test.aal','aal2',false);
SELECT t('non-owner with MFA still refused', raises($q$SELECT * FROM platform_finance_report('2026-10')$q$, 'not_platform_owner'));
SELECT set_config('test.uid','99999999-0000-0000-0000-000000000000',false);
SELECT t('period injection attempt rejected', raises($q$SELECT * FROM platform_finance_report('2026-10'' OR 1=1 --')$q$, 'invalid_period'));
SELECT set_config('test.aal','',false);
SELECT t('owner with missing aal claim refused', raises($q$SELECT * FROM platform_finance_report('2026-10')$q$, 'mfa_required'));
RESET ROLE;

SET ROLE service_role;
SELECT t('commission write: tenant derived from payment, not caller', record_platform_commission('00000000-0000-0000-0000-0000000000a2','expected',35,'route','') = 'inserted'
  AND (SELECT tenant_id FROM platform_commission_entries WHERE payment_id='00000000-0000-0000-0000-0000000000a2') = 'aaaaaaaa-0000-0000-0000-000000000000');
SELECT t('repeated webhook: same commission = duplicate, no second row', record_platform_commission('00000000-0000-0000-0000-0000000000a2','expected',35,'route','') = 'duplicate'
  AND (SELECT count(*) FROM platform_commission_entries WHERE payment_id='00000000-0000-0000-0000-0000000000a2') = 1);
SELECT t('conflicting amount for same key is an error, not ignored', raises($q$SELECT record_platform_commission('00000000-0000-0000-0000-0000000000a2','expected',30,'route','')$q$, 'commission_conflict'));
SELECT t('failed commission write surfaces: unknown payment', raises($q$SELECT record_platform_commission(gen_random_uuid(),'confirmed',35,'viva_webhook','t1')$q$, 'payment_not_found'));
SELECT t('failed commission write surfaces: amount above payment', raises($q$SELECT record_platform_commission('00000000-0000-0000-0000-0000000000a2','confirmed',501,'viva_webhook','t1')$q$, 'commission_exceeds_payment'));
SELECT t('failed commission write surfaces: invalid kind', NOT raises($q$SELECT record_platform_commission('00000000-0000-0000-0000-0000000000a2','bonus',1,'route','')$q$, 'inserted'));
SELECT t('refund reversal is its own entry per refund reference', record_platform_commission('00000000-0000-0000-0000-0000000000a1','reversed',35,'viva_webhook','refund-1') = 'inserted');
RESET ROLE;

-- Backfill: synthetic legacy rows (paid with key, unpaid with key, invalid value).
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,paid_at,metadata) VALUES
 ('00000000-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000000',40,false,'viva','paid','2026-10-01','{"platform_fee_cents":30,"glowpay_margin_cents":30,"provider_fee_cents":12}'),
 ('00000000-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-000000000000',50,false,'viva','refunded','2026-10-02','{"platform_fee_cents":30}'),
 ('00000000-0000-0000-0000-0000000000c3','aaaaaaaa-0000-0000-0000-000000000000',60,false,'viva','pending',NULL,'{"platform_fee_cents":30}'),
 ('00000000-0000-0000-0000-0000000000c4','aaaaaaaa-0000-0000-0000-000000000000',70,false,'viva','paid','2026-10-03','{"platform_fee_cents":"abc"}');
UPDATE payments SET paid_at='2026-10-14' WHERE id='00000000-0000-0000-0000-0000000000b1';
\o /dev/null
\i 2026-10-14_isv_commission_backfill.sql
\i 2026-10-14_isv_commission_verify.sql
\o
SELECT t('backfill: only paid valid rows copied (b1,c1,c2)', (SELECT count(*) FROM platform_commission_entries WHERE kind='legacy_margin') = 3
  AND (SELECT sum(amount_cents) FROM platform_commission_entries WHERE kind='legacy_margin') = 90);
SELECT t('backfill: metadata not removed', (SELECT count(*) FROM payments WHERE metadata ? 'platform_fee_cents') = 5);
\o /dev/null
\i 2026-10-14_isv_commission_backfill.sql
\i 2026-10-14_isv_commission_verify.sql
\o
SELECT t('backfill re-run: no duplicates', (SELECT count(*) FROM platform_commission_entries WHERE kind='legacy_margin') = 3);
DELETE FROM platform_commission_entries WHERE payment_id='00000000-0000-0000-0000-0000000000c2' AND kind='legacy_margin';
\o /dev/null
\i 2026-10-14_isv_commission_backfill.sql
\i 2026-10-14_isv_commission_verify.sql
\o
SELECT t('partial backfill: re-run restores missing entry', (SELECT count(*) FROM platform_commission_entries WHERE kind='legacy_margin') = 3);
INSERT INTO platform_commission_entries (payment_id,tenant_id,kind,amount_cents,source,provider_reference,is_demo)
 VALUES ('00000000-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000000','legacy_margin',99,'legacy_backfill','x',false);
DO $$ BEGIN
  BEGIN
    EXECUTE pg_read_file('/tmp/gs-pg-commission/2026-10-14_isv_commission_verify.sql');
    PERFORM t('verify detects mismatch', false);
  EXCEPTION WHEN OTHERS THEN PERFORM t('verify detects mismatch', SQLERRM LIKE 'backfill_mismatch%'); END;
END $$;
DELETE FROM platform_commission_entries WHERE provider_reference='x';
\o /dev/null
\i 2026-10-14_isv_commission_strip.sql
\o
SELECT t('strip: paid backfilled rows cleaned', NOT EXISTS (SELECT 1 FROM payments WHERE id IN ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b1') AND metadata ?| ARRAY['platform_fee_cents','glowpay_margin_cents','provider_fee_cents']));
SELECT t('strip: unpaid and invalid rows untouched', (SELECT count(*) FROM payments WHERE id IN ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c4') AND metadata ? 'platform_fee_cents') = 2);
SELECT t('strip: totals still match entries after strip', (SELECT sum(amount_cents) FROM platform_commission_entries WHERE kind='legacy_margin') = 90);
SET ROLE authenticated; SELECT set_config('test.uid','99999999-0000-0000-0000-000000000000',false), set_config('test.aal','aal2',false);
SELECT t('report shows legacy margin separately from ISV earnings', (SELECT legacy_margin_cents=30 AND earned_cents=0 FROM platform_finance_report('2026-10','bbbbbbbb-0000-0000-0000-000000000000')));
RESET ROLE;
