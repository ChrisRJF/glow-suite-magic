-- Oefenmodus. Fictief: P = echte (niet-demo) salon zonder KYC/merchant/terminal; PS = medewerker; PF = financieel.
\set P '''eeeeeeee-0000-0000-0000-0000000000a1'''
\set PS '''eeeeeeee-0000-0000-0000-0000000000a2'''
\set PF '''eeeeeeee-0000-0000-0000-0000000000a3'''
\set PP '''e0000000-0000-0000-0000-0000000000p1'''
\set PSV '''e0000000-0000-0000-0000-0000000000s1'''
\set PC '''e0000000-0000-0000-0000-0000000000c1'''

INSERT INTO user_roles (user_id, role) VALUES (:P,'eigenaar');
INSERT INTO user_access VALUES (:P,:PS,'medewerker','active',false),(:P,:PF,'financieel','active',false);
INSERT INTO settings (user_id,is_demo,demo_mode) VALUES (:P,false,false);
INSERT INTO tenant_feature_flags (tenant_id, kassa_orders_enabled, live_payments_enabled, kassa_practice_enabled) VALUES (:P,false,false,true);
INSERT INTO products VALUES ('e0000000-0000-0000-0000-0000000000f1',:P,'Echte creme',30,5,true,false,now());
INSERT INTO services VALUES ('e0000000-0000-0000-0000-0000000000f2',:P,'Echte behandeling',50,true,false);
INSERT INTO customers (id,user_id,name,is_demo) VALUES ('e0000000-0000-0000-0000-0000000000f3',:P,'Fictieve klant',false);

SET ROLE authenticated;
-- Standaard UIT: salon A (geen oefenschakelaar) kan niet oefenen.
SELECT set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false);
SELECT ok((kassa_payment_status()->>'practice')::boolean = false, 'oefen: standaard uit');
SELECT ok((kassa_practice_checkout(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id','a0000000-0000-0000-0000-0000000000a1','qty',1)))->>'reason') = 'practice_disabled', 'oefen: uit = geweigerd');

SELECT set_config('test.uid', :P, false);
SELECT ok((kassa_payment_status()->>'practice')::boolean AND (kassa_payment_status()->>'terminal') = 'demo', 'oefen: aan, live blijft uit');
SELECT kassa_practice_checkout('eeeeeeee-1111-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000f3', jsonb_build_array(
  jsonb_build_object('type','product','item_id','e0000000-0000-0000-0000-0000000000f1','qty',2,'price',0.01),
  jsonb_build_object('type','service','item_id','e0000000-0000-0000-0000-0000000000f2','qty',1))) AS r \gset p1_
SELECT ok((:'p1_r'::jsonb->>'total_cents')::int = 11000 AND (:'p1_r'::jsonb->>'status') = 'practice_paid', 'oefen: echte prijzen gelezen, browserprijs genegeerd, Demo betaald');
SELECT ok((kassa_practice_checkout('eeeeeeee-1111-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000f3', jsonb_build_array(
  jsonb_build_object('type','product','item_id','e0000000-0000-0000-0000-0000000000f1','qty',2,'price',0.01),
  jsonb_build_object('type','service','item_id','e0000000-0000-0000-0000-0000000000f2','qty',1)))->>'duplicate')::boolean, 'oefen: herhaalde bevestiging = zelfde bestelling');
SELECT ok((kassa_practice_checkout('eeeeeeee-1111-0000-0000-000000000001', NULL, jsonb_build_array(
  jsonb_build_object('type','product','item_id','e0000000-0000-0000-0000-0000000000f1','qty',9)))->>'reason') = 'conflict', 'oefen: zelfde ID andere inhoud = conflict');
SELECT ok((kassa_create_order('eeeeeeee-1111-0000-0000-000000000001', NULL, jsonb_build_array(
  jsonb_build_object('type','product','item_id','e0000000-0000-0000-0000-0000000000f1','qty',1)), true)->>'reason') = 'disabled', 'oefen: geen normale Kassa zonder Kassa-schakelaar');
SELECT ok((kassa_practice_checkout(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','product','item_id','a0000000-0000-0000-0000-0000000000a1','qty',1)))->>'reason') = 'item_not_found', 'oefen: product andere salon geweigerd');
SELECT ok((kassa_practice_checkout(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000c1', jsonb_build_array(jsonb_build_object('type','product','item_id','e0000000-0000-0000-0000-0000000000f1','qty',1)))->>'reason') = 'customer_not_found', 'oefen: klant andere salon geweigerd');
SELECT err($$UPDATE tenant_feature_flags SET kassa_practice_enabled = true$$, 'oefen: salon zet schakelaar niet zelf');
SELECT err($$SELECT * FROM kassa_orders$$, 'oefen: bestellingen niet direct leesbaar');

SELECT set_config('test.uid', :PS, false);
SELECT ok((kassa_practice_checkout(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','service','item_id','e0000000-0000-0000-0000-0000000000f2','qty',1)))->>'ok')::boolean, 'oefen: medewerker kan oefenen');
SELECT set_config('test.uid', :PF, false);
SELECT ok((kassa_practice_checkout(gen_random_uuid(), NULL, jsonb_build_array(jsonb_build_object('type','service','item_id','e0000000-0000-0000-0000-0000000000f2','qty',1)))->>'reason') = 'no_access', 'oefen: financieel geen kassarecht');
-- Andere salon ziet oefenbestellingen van P niet.
SELECT set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false);
SELECT ok(NOT EXISTS (SELECT 1 FROM kassa_open_orders(true) WHERE order_id = (:'p1_r'::jsonb->>'order_id')::uuid), 'oefen: andere salon ziet niets');
RESET ROLE;

-- Echte betaalpaden weigeren oefenbestellingen.
SET ROLE service_role;
SELECT ok((kassa_begin_attempt(:P, (:'p1_r'::jsonb->>'order_id')::uuid)->>'reason') = 'practice', 'oefen: geen Viva/Mollie-poging mogelijk');
RESET ROLE;
INSERT INTO payments (id,user_id,amount,is_demo,provider,status,metadata) VALUES ('77777777-0000-0000-0000-0000000000e1',:P,110,true,'viva','pending',jsonb_build_object('kassa_order_id',:'p1_r'::jsonb->>'order_id'));
SET ROLE service_role;
SELECT ok(NOT kassa_attach_payment((:'p1_r'::jsonb->>'order_id')::uuid, 'x', '77777777-0000-0000-0000-0000000000e1'), 'oefen: geen betaling koppelbaar');
RESET ROLE;
DELETE FROM payments WHERE id = '77777777-0000-0000-0000-0000000000e1';
SELECT err($$UPDATE kassa_orders SET status = 'payment_open' WHERE is_practice$$, 'oefen: kan nooit een open betaling worden');
SELECT err($$UPDATE kassa_orders SET is_demo = false WHERE is_practice$$, 'oefen: kan nooit live worden');

-- Geen financiele effecten.
SELECT ok((SELECT stock FROM products WHERE id = 'e0000000-0000-0000-0000-0000000000f1') = 5, 'oefen: voorraad ongewijzigd');
SELECT ok((SELECT coalesce(total_spent,0) FROM customers WHERE id = 'e0000000-0000-0000-0000-0000000000f3') = 0, 'oefen: klantbesteding ongewijzigd');
SELECT ok((SELECT count(*) FROM checkout_items WHERE user_id = :P) = 0, 'oefen: geen kassaregels/omzet');
SELECT ok((SELECT count(*) FROM payments WHERE user_id = :P) = 0, 'oefen: geen betaalrecords');
SELECT ok((SELECT count(*) FROM payment_ledger WHERE tenant_id = :P) = 0, 'oefen: geen grootboek');
SELECT ok((SELECT count(*) FROM kassa_payment_attempts a JOIN kassa_orders o ON o.id = a.order_id WHERE o.tenant_id = :P) = 0, 'oefen: geen betaalpogingen');
SELECT ok((SELECT count(*) FROM kassa_orders WHERE tenant_id = :P AND is_practice AND status = 'practice_paid') = 2, 'oefen: precies twee oefenbestellingen');
