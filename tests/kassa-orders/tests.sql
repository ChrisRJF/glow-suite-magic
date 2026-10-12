-- Fictional salons only. A = live salon (full KYC + platform activation), B = other salon,
-- D = demo salon (no KYC), K = KYC approved but live not activated by platform.
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set STAFF '''aaaaaaaa-0000-0000-0000-000000000002'''
\set FIN '''aaaaaaaa-0000-0000-0000-000000000004'''
\set MULTI '''aaaaaaaa-0000-0000-0000-000000000003'''
\set B '''bbbbbbbb-0000-0000-0000-000000000001'''
\set D '''dddddddd-0000-0000-0000-000000000001'''
\set K '''cccccccc-0000-0000-0000-000000000001'''
\set PA '''a0000000-0000-0000-0000-0000000000a1'''
\set SA '''a0000000-0000-0000-0000-0000000000a2'''
\set PB '''b0000000-0000-0000-0000-0000000000b1'''
\set PD '''d0000000-0000-0000-0000-0000000000d1'''
\set PK '''c0000000-0000-0000-0000-0000000000c1'''
\set CA '''a0000000-0000-0000-0000-0000000000c1'''
\set CB '''b0000000-0000-0000-0000-0000000000c1'''

CREATE FUNCTION ok(b boolean, n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '%: %', CASE WHEN coalesce(b,false) THEN 'PASS' ELSE 'FAIL' END, n; END $$;
CREATE FUNCTION err(q text, n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RAISE NOTICE 'FAIL: % (no error)', n; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS: % (%)', n, SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION ok(boolean,text), err(text,text) TO PUBLIC;

-- Fixtures (server side).
INSERT INTO user_roles (user_id, role) VALUES (:A,'eigenaar'),(:B,'eigenaar'),(:D,'eigenaar'),(:K,'eigenaar');
INSERT INTO user_access VALUES (:A,:STAFF,'medewerker','active',false),(:A,:FIN,'financieel','active',false),
  (:A,:MULTI,'receptie','active',false),(:B,:MULTI,'receptie','active',false);
INSERT INTO settings (user_id,is_demo,demo_mode) VALUES (:A,false,false),(:B,false,false),(:D,true,true),(:K,false,false);
INSERT INTO tenant_feature_flags (tenant_id, kassa_orders_enabled, live_payments_enabled) VALUES (:A,true,true),(:B,true,true),(:D,true,false),(:K,true,false);
INSERT INTO glowpay_connected_merchants (user_id,is_demo,viva_merchant_id,viva_source_code,onboarding_status,kyc_status,setup_complete,terminals_enabled,online_payments_enabled)
  VALUES (:A,false,'m-a','1234','connected','verified',true,true,false),(:K,false,'m-k','5678','connected','verified',true,true,true);
INSERT INTO products VALUES (:PA,:A,'Serum',25,1,true,false,now()),(:PB,:B,'Andere salon',1,10,true,false,now()),(:PD,:D,'Demo serum',10,5,true,true,now()),(:PK,:K,'K',10,5,true,false,now());
INSERT INTO services VALUES (:SA,:A,'Facial',40,true,false);
INSERT INTO customers (id,user_id,name,is_demo) VALUES (:CA,:A,'Fictief A',false),(:CB,:B,'Fictief B',false);

-- 1. Demo zonder KYC.
SET ROLE authenticated; SELECT set_config('test.uid', :D, false);
SELECT ok((kassa_payment_status()->>'terminal') = 'demo', 'demo salon: status demo');
SELECT kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PD,'qty',2)), true) AS r \gset d_
SELECT ok((:'d_r'::jsonb->>'ok')::boolean AND (:'d_r'::jsonb->>'total_cents')::int = 2000, 'demo salon: bewuste demobestelling, totaal 20,00');
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PD,'qty',1)), false)->>'reason') = 'live_not_allowed', 'demo salon: live geweigerd, geen automatische demo');
-- 2. KYC goedgekeurd maar live niet geactiveerd.
SELECT set_config('test.uid', :K, false);
SELECT ok((kassa_payment_status()->>'terminal') = 'demo', 'KYC ok zonder platformactivatie: status demo');
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PK,'qty',1)), false)->>'reason') = 'live_not_allowed', 'KYC ok zonder activatie: live geweigerd');
-- 3. Volledig goedgekeurd + geactiveerd.
SELECT set_config('test.uid', :A, false);
SELECT ok((kassa_payment_status()->>'terminal') = 'live', 'volledig + geactiveerd: live');

-- 4. Vervalsen KYC / betaalstatus / schakelaars als saloneigenaar.
SELECT err($$UPDATE glowpay_connected_merchants SET kyc_status='pending' WHERE user_id='cccccccc-0000-0000-0000-000000000001'$$, 'eigenaar wijzigt KYC');
SELECT err($$UPDATE glowpay_connected_merchants SET terminals_enabled=false WHERE user_id='cccccccc-0000-0000-0000-000000000001'$$, 'eigenaar zet pinbevoegdheid aan');
INSERT INTO glowpay_connected_merchants (user_id,is_demo,viva_merchant_id,kyc_status,setup_complete,terminals_enabled)
  VALUES ('eeeeeeee-0000-0000-0000-000000000001',false,'fake','verified',true,true);
SELECT ok((SELECT kyc_status='pending' AND NOT setup_complete AND NOT terminals_enabled AND viva_merchant_id IS NULL FROM glowpay_connected_merchants WHERE user_id='eeeeeeee-0000-0000-0000-000000000001'), 'eigen merchant-rij: bevoegdheden geforceerd uit');
SELECT err($$UPDATE tenant_feature_flags SET live_payments_enabled=true$$, 'eigenaar zet live-schakelaar');
SELECT err($$INSERT INTO payments (user_id,amount,is_demo,provider,status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001',25,false,'viva','paid')$$, 'client maakt betaalde Viva-betaling');
RESET ROLE;
INSERT INTO payments (id,user_id,amount,is_demo,provider,status) VALUES ('99999999-0000-0000-0000-000000000001',:A,10,false,'viva','pending'),('99999999-0000-0000-0000-000000000002',:A,10,false,NULL,'pending');
SET ROLE authenticated;
SELECT err($$UPDATE payments SET status='paid' WHERE id='99999999-0000-0000-0000-000000000001'$$, 'client zet Viva-betaling op betaald');
UPDATE payments SET status='paid' WHERE id='99999999-0000-0000-0000-000000000002';
SELECT ok((SELECT status='paid' FROM payments WHERE id='99999999-0000-0000-0000-000000000002'), 'handmatige betaling: bestaand gedrag blijft');

-- 5. Gemanipuleerd bedrag, producten/klant van andere salon, request-ID hergebruik.
SELECT kassa_create_order('11111111-0000-0000-0000-000000000001', :CA, jsonb_build_array(
  jsonb_build_object('type','product','item_id',:PA,'qty',1,'price',0.01), jsonb_build_object('type','service','item_id',:SA,'qty',1,'price',0.01)), false) AS r \gset o1_
SELECT ok((:'o1_r'::jsonb->>'total_cents')::int = 6500, 'browserprijs genegeerd: totaal 65,00 uit database');
SELECT (:'o1_r'::jsonb->>'order_id') AS id \gset o1_
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PB,'qty',1)), false)->>'reason') = 'item_not_found', 'product andere salon geweigerd');
SELECT ok((kassa_create_order(gen_random_uuid(), :CB, jsonb_build_array(jsonb_build_object('type','product','item_id',:PA,'qty',1)), false)->>'reason') = 'customer_not_found', 'klant andere salon geweigerd');
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PA,'qty',0)), false)->>'reason') = 'invalid', 'aantal 0 geweigerd');
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PA)), false)->>'reason') = 'invalid', 'ontbrekend aantal geweigerd');
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id',:PD,'qty',1)), true)->>'reason') = 'item_not_found', 'demoproduct in live salon geweigerd');
SELECT ok((kassa_create_order('11111111-0000-0000-0000-000000000001', :CA, jsonb_build_array(jsonb_build_object('type','product','item_id',:PA,'qty',5)), false)->>'reason') = 'conflict', 'zelfde request-ID andere inhoud: conflict');
SELECT ok((kassa_create_order('11111111-0000-0000-0000-000000000001', :CA, jsonb_build_array(
  jsonb_build_object('type','product','item_id',:PA,'qty',1,'price',0.01), jsonb_build_object('type','service','item_id',:SA,'qty',1,'price',0.01)), false)->>'duplicate')::boolean, 'dubbelklik: zelfde bestelling terug');
SELECT ok((SELECT count(*) FROM kassa_open_orders(false)) = 1, 'open bestellingen: alleen eigen salon/omgeving');
SELECT err($$SELECT kassa_settle_order('99999999-0000-0000-0000-000000000001')$$, 'app-gebruiker kan niet zelf verwerken');
SELECT err($$SELECT kassa_begin_attempt('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid())$$, 'app-gebruiker kan geen poging starten');
SELECT err($$SELECT * FROM kassa_orders$$, 'app-gebruiker leest bestellingen niet direct');

-- 6. Rechten en tenantisolatie.
SELECT set_config('test.uid', :STAFF, false);
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','service','item_id',:SA,'qty',1)), false)->>'ok')::boolean, 'medewerker kan afrekenen in eigen salon');
SELECT set_config('test.uid', :FIN, false);
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','service','item_id',:SA,'qty',1)), false)->>'reason') = 'no_access', 'financieel: geen kassarecht');
SELECT set_config('test.uid', :MULTI, false);
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','service','item_id',:SA,'qty',1)), false)->>'reason') = 'no_access', 'lid van twee salons: geblokkeerd');
RESET ROLE; SET ROLE sandbox_exec;
SELECT err($$SELECT * FROM kassa_orders$$, 'sandbox_exec leest bestellingen niet');
RESET ROLE;

-- 7. Betaalpogingen: twee apparaten, andere salon.
SET ROLE service_role;
SELECT ok((kassa_begin_attempt(:B, :'o1_id')->>'reason') = 'not_found', 'andere salon kan niet afrekenen op bestelling');
SELECT kassa_begin_attempt(:A, :'o1_id') AS r \gset a1_
SELECT kassa_begin_attempt(:STAFF, :'o1_id') AS r \gset a2_
SELECT ok((:'a1_r'::jsonb->>'idempotency_key') = (:'a2_r'::jsonb->>'idempotency_key') AND (:'a2_r'::jsonb->>'resumed')::boolean, 'tweede apparaat hervat dezelfde poging');
SELECT ok((SELECT count(*) FROM kassa_payment_attempts WHERE order_id = :'o1_id' AND state='open') = 1, 'precies een open poging');
RESET ROLE;
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES ('77777777-0000-0000-0000-000000000001',:A,65,false,'viva','pending',jsonb_build_object('kassa_order_id',:'o1_id'));
SET ROLE service_role;
SELECT ok(kassa_attach_payment(:'o1_id', :'a1_r'::jsonb->>'idempotency_key', '77777777-0000-0000-0000-000000000001'), 'betaling gekoppeld');
SELECT ok(NOT kassa_attach_payment(:'o1_id', :'a1_r'::jsonb->>'idempotency_key', '99999999-0000-0000-0000-000000000001'), 'tweede betaling niet koppelbaar');
RESET ROLE;

-- 8. Alleen payments.status = paid is onvoldoende.
UPDATE payments SET status='paid' WHERE id='77777777-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT ok(kassa_settle_order('77777777-0000-0000-0000-000000000001') = 'no_evidence', 'status paid zonder providerbewijs: niet verwerkt');
SELECT ok((SELECT stock FROM products WHERE id = :PA) = 1, 'voorraad onaangeroerd zonder bewijs');

-- 9. Onderbroken verwerking + herstel.
RESET ROLE;
SELECT record_provider_payment(:A, '77777777-0000-0000-0000-000000000001', 'viva', 'tx-1', 'payment', 6500, 'EUR', 'poll');
ALTER TABLE checkout_items ADD CONSTRAINT simulate_crash CHECK (quantity < 0) NOT VALID;
SET ROLE service_role;
SELECT err($$SELECT kassa_settle_order('77777777-0000-0000-0000-000000000001')$$, 'verwerking onderbroken');
SELECT ok((SELECT stock FROM products WHERE id = :PA) = 1 AND (SELECT status FROM kassa_orders WHERE id = :'o1_id') = 'payment_open', 'na onderbreking: niets half verwerkt');
RESET ROLE; ALTER TABLE checkout_items DROP CONSTRAINT simulate_crash; SET ROLE service_role;

-- 10. Eenmalige verwerking, ook bij herhaalde/parallelle bevestiging.
SELECT ok(kassa_settle_order('77777777-0000-0000-0000-000000000001') = 'settled', 'herstel: verwerkt');
SELECT ok(kassa_settle_order('77777777-0000-0000-0000-000000000001') = 'duplicate', 'tweede bevestiging: niets opnieuw');
RESET ROLE;
SELECT ok(record_provider_payment(:A, '77777777-0000-0000-0000-000000000001', 'viva', 'tx-1', 'payment', 6500, 'EUR', 'webhook') = 'duplicate', 'webhook na poll: grootboek dubbel geweigerd');
SELECT ok((SELECT stock FROM products WHERE id = :PA) = 0, 'voorraad precies een keer verlaagd');
SELECT ok((SELECT total_spent FROM customers WHERE id = :CA) = 65, 'klantomzet precies een keer verhoogd');
SELECT ok((SELECT count(*) FROM checkout_items WHERE user_id = :A) = 2, 'kassaregels precies een keer');

-- 11. Mislukte betaling: geen voorraad/omzet, nieuwe poging nieuwe sleutel.
SET ROLE authenticated; SELECT set_config('test.uid', :A, false);
SELECT (kassa_create_order(gen_random_uuid(), :CA, jsonb_build_array(jsonb_build_object('type','product','item_id',:PA,'qty',3)), false)->>'order_id') AS id \gset o2_
RESET ROLE; SET ROLE service_role;
SELECT kassa_begin_attempt(:A, :'o2_id') AS r \gset b1_
RESET ROLE;
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES ('77777777-0000-0000-0000-000000000002',:A,75,false,'viva','failed',jsonb_build_object('kassa_order_id',:'o2_id'));
SET ROLE service_role;
SELECT kassa_attach_payment(:'o2_id', :'b1_r'::jsonb->>'idempotency_key', '77777777-0000-0000-0000-000000000002');
SELECT ok(kassa_attempt_failed('77777777-0000-0000-0000-000000000002') = 'failed', 'mislukt: poging gesloten');
SELECT ok((SELECT total_spent FROM customers WHERE id = :CA) = 65 AND (SELECT stock FROM products WHERE id = :PA) = 0, 'mislukt: geen omzet of voorraadwijziging');
SELECT kassa_begin_attempt(:A, :'o2_id') AS r \gset b2_
SELECT ok((:'b2_r'::jsonb->>'idempotency_key') LIKE '%:live:2', 'nieuwe poging: nieuwe sleutel');

-- 12. Voorraadtekort na bevestigde betaling.
RESET ROLE;
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES ('77777777-0000-0000-0000-000000000003',:A,75,false,'viva','paid',jsonb_build_object('kassa_order_id',:'o2_id'));
SET ROLE service_role;
SELECT kassa_attach_payment(:'o2_id', :'b2_r'::jsonb->>'idempotency_key', '77777777-0000-0000-0000-000000000003');
RESET ROLE;
SELECT record_provider_payment(:A, '77777777-0000-0000-0000-000000000003', 'viva', 'tx-3', 'payment', 7500, 'EUR', 'webhook');
SET ROLE service_role;
SELECT ok(kassa_settle_order('77777777-0000-0000-0000-000000000003') = 'settled', 'tekort: betaling toch verwerkt');
RESET ROLE;
SELECT ok((SELECT stock FROM products WHERE id = :PA) = 0 AND (SELECT stock_shortfall FROM kassa_order_lines WHERE order_id = :'o2_id') = 3, 'tekort: voorraad niet negatief, tekort vastgelegd');

-- 13. Demo-order wijzigt nooit echte voorraad/omzet/regels.
SET ROLE service_role;
SELECT (:'d_r'::jsonb->>'order_id') AS id \gset do_
SELECT kassa_begin_attempt(:D, :'do_id') AS r \gset dk_
SELECT ok((:'dk_r'::jsonb->>'idempotency_key') LIKE '%:demo:1', 'demo-sleutel bevat omgeving');
RESET ROLE;
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES ('77777777-0000-0000-0000-000000000004',:D,20,true,'viva','paid',jsonb_build_object('kassa_order_id',:'do_id'));
SET ROLE service_role;
SELECT kassa_attach_payment(:'do_id', :'dk_r'::jsonb->>'idempotency_key', '77777777-0000-0000-0000-000000000004');
RESET ROLE;
SELECT record_provider_payment(:D, '77777777-0000-0000-0000-000000000004', 'viva', 'tx-d', 'payment', 2000, 'EUR', 'poll');
SET ROLE service_role;
SELECT ok(kassa_settle_order('77777777-0000-0000-0000-000000000004') = 'settled_demo', 'demo: alleen als demo afgerond');
RESET ROLE;
SELECT ok((SELECT stock FROM products WHERE id = :PD) = 5 AND (SELECT count(*) FROM checkout_items WHERE user_id = :D) = 0, 'demo: geen voorraad of kassaregels');
SELECT ok(NOT kassa_attach_payment(:'o2_id', 'x', '77777777-0000-0000-0000-000000000004'), 'demobetaling kan live bestelling niet vervangen');

-- 14. Live-activatie ingetrokken: geen nieuwe live poging.
UPDATE tenant_feature_flags SET live_payments_enabled = false WHERE tenant_id = :A;
SET ROLE authenticated; SELECT set_config('test.uid', :A, false);
SELECT ok((kassa_create_order(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','service','item_id',:SA,'qty',1)), false)->>'reason') = 'live_not_allowed', 'live uitgezet: live bestelling geweigerd');
RESET ROLE;
