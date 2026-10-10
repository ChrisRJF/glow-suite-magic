\set ON_ERROR_STOP 1
-- Tenants are fixed fictitious ids.
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
-- Tenant A: 6.623 pairs (10 with differing names) + 2.656 singles = 15.902 records.
INSERT INTO customers(user_id,name,email,phone,privacy_consent,marketing_consent,whatsapp_opt_in,created_at,updated_at)
SELECT :A, 'Fictief '||i, 'f'||i||'@voorbeeld.test', '06'||(10000000+i), true, (i%2=0), (i%3=0),
       timestamptz '2025-01-01' + i*interval '1 min', timestamptz '2025-06-01' FROM generate_series(1,6623) i;
INSERT INTO customers(user_id,name,email,phone,privacy_consent,marketing_consent,whatsapp_opt_in,created_at,updated_at)
SELECT :A, CASE WHEN i<=10 THEN 'Ander '||i ELSE ' fictief  '||i END, 'F'||i||'@Voorbeeld.test ', '+31 6 '||(10000000+i),
       true, (i%2=0), (i%3=0), timestamptz '2026-01-01' + i*interval '1 min', timestamptz '2026-06-01' FROM generate_series(1,6623) i;
INSERT INTO customers(user_id,name,email,phone,created_at,updated_at)
SELECT :A, 'Enkel '||i, 's'||i||'@voorbeeld.test', '06'||(30000000+i), now(), now() FROM generate_series(1,2656) i;
-- Tenant B: identical contact data as A's first 50 pairs (isolation); Tenant C: 5 pairs with consent difference.
INSERT INTO customers(user_id,name,email,phone,created_at,updated_at)
SELECT :B, 'Fictief '||i, 'f'||i||'@voorbeeld.test', '06'||(10000000+i), now()-interval '1 day'*k, now()
FROM generate_series(11,60) i, generate_series(1,2) k;
INSERT INTO customers(user_id,name,email,phone,marketing_consent,created_at,updated_at)
SELECT :C, 'C '||i, 'c'||i||'@voorbeeld.test', '06'||(50000000+i), k=1, now()-interval '1 day'*k, now()
FROM generate_series(1,5) i, generate_series(1,2) k;

DO $$ BEGIN ASSERT (SELECT count(*) FROM customers WHERE user_id='00000000-0000-0000-0000-00000000000a')=15902; END $$;
CREATE TABLE _before AS SELECT id, to_jsonb(c) AS row FROM customers c;

-- Preview A
CREATE TABLE _r AS SELECT dedupe_preview(:A) AS r;
SELECT 'preview A: '||(SELECT r - 'batch' FROM _r)::text;
DO $$ DECLARE r jsonb := (SELECT r FROM _r); BEGIN
  ASSERT (r->>'planned')::int = 6613, 'planned';
  ASSERT (r->>'manual_review_name_differs')::int = 10, 'name differs';
  ASSERT NOT EXISTS (SELECT 1 FROM customer_merge_pairs p JOIN customers c ON c.id IN (p.survivor_id,p.duplicate_id)
     WHERE p.batch_id=(r->>'batch')::uuid AND c.user_id <> '00000000-0000-0000-0000-00000000000a'), 'tenant isolation';
  ASSERT NOT EXISTS (SELECT 1 FROM customer_merge_pairs p JOIN customers s ON s.id=p.survivor_id JOIN customers d ON d.id=p.duplicate_id
     WHERE (s.created_at, s.id) > (d.created_at, d.id)), 'survivor = oldest';
END $$;
-- Tenant C consent difference -> nothing planned
DO $$ DECLARE r jsonb := dedupe_preview('00000000-0000-0000-0000-00000000000c'); BEGIN
  ASSERT (r->>'planned')::int = 0 AND (r->>'manual_review_consent_differs')::int = 5, 'consent'; END $$;

-- Concurrent changes after preview: a reference, a legal hold, an edit.
INSERT INTO appointments(customer_id) SELECT duplicate_id FROM customer_merge_pairs ORDER BY duplicate_id LIMIT 1;
INSERT INTO legal_holds(customer_id) SELECT survivor_id FROM customer_merge_pairs ORDER BY duplicate_id OFFSET 1 LIMIT 1;
UPDATE customers SET notes='gewijzigd', updated_at=now() WHERE id=(SELECT duplicate_id FROM customer_merge_pairs ORDER BY duplicate_id OFFSET 2 LIMIT 1);
UPDATE _before b SET row = to_jsonb(c) FROM customers c WHERE c.id=b.id;

-- Dry run writes nothing
CREATE TABLE _dry AS SELECT dedupe_apply((SELECT (r->>'batch')::uuid FROM _r), true) AS r;
SELECT 'dry run: '||(SELECT r FROM _dry)::text;
DO $$ BEGIN ASSERT ((SELECT r FROM _dry)->>'would_apply')::int = 6610;
  ASSERT NOT EXISTS (SELECT 1 FROM customers WHERE merged_into IS NOT NULL), 'dry wrote'; END $$;

-- Apply
CREATE TABLE _ap AS SELECT dedupe_apply((SELECT (r->>'batch')::uuid FROM _r), false) AS r;
SELECT 'apply: '||(SELECT r FROM _ap)::text;
DO $$ BEGIN
  ASSERT ((SELECT r FROM _ap)->>'would_apply')::int = 6610;
  ASSERT (SELECT count(*) FROM customers WHERE merged_into IS NOT NULL) = 6610;
  ASSERT (SELECT count(*) FROM customers WHERE user_id='00000000-0000-0000-0000-00000000000a') = 15902, 'nothing deleted';
  ASSERT (SELECT count(*) FROM customers WHERE user_id='00000000-0000-0000-0000-00000000000a' AND merged_into IS NULL) = 9292, 'visible list';
  ASSERT NOT EXISTS (SELECT 1 FROM customers c JOIN _before b ON b.id=c.id
     WHERE (to_jsonb(c)-'merged_into'-'merged_at'-'merge_batch_id') <> (b.row-'merged_into'-'merged_at'-'merge_batch_id')), 'original values incl. consent and updated_at kept';
  ASSERT NOT EXISTS (SELECT 1 FROM customers WHERE user_id <> '00000000-0000-0000-0000-00000000000a' AND merged_into IS NOT NULL), 'B/C untouched';
END $$;
-- Idempotent re-run
DO $$ BEGIN ASSERT dedupe_apply((SELECT (r->>'batch')::uuid FROM _r), false) ? 'noop';
  ASSERT (SELECT count(*) FROM customers WHERE merged_into IS NOT NULL) = 6610; END $$;

-- Undo conflict: a merged row edited afterwards blocks undo (whole transaction).
SAVEPOINT s1;
UPDATE customers SET notes='later' WHERE id=(SELECT id FROM customers WHERE merged_into IS NOT NULL ORDER BY id LIMIT 1);
DO $$ BEGIN PERFORM dedupe_undo((SELECT (r->>'batch')::uuid FROM _r)); RAISE EXCEPTION 'expected conflict';
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'undo_conflict%' THEN RAISE; END IF; END $$;
ROLLBACK TO s1;

-- Undo -> byte-identical to pre-state
SELECT 'undo: '||dedupe_undo((SELECT (r->>'batch')::uuid FROM _r))::text;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM customers c FULL JOIN _before b ON b.id=c.id WHERE to_jsonb(c)-'merged_into'-'merged_at'-'merge_batch_id' IS DISTINCT FROM (b.row-'merged_into'-'merged_at'-'merge_batch_id')
     OR c.merged_into IS NOT NULL OR c.merge_batch_id IS NOT NULL), 'undo exact';
  ASSERT (SELECT count(*) FROM audit_logs WHERE action LIKE 'customer_dedupe_%') = 2, 'audit';
END $$;
-- Re-run after undo
DO $$ DECLARE r jsonb := dedupe_preview('00000000-0000-0000-0000-00000000000a'); BEGIN
  ASSERT (r->>'planned')::int = 6613; ASSERT (dedupe_apply((r->>'batch')::uuid, true)->>'would_apply')::int = 6610; END $$;
-- Missing linked table must abort, not be ignored.
DROP TABLE privacy_requests;
DO $$ BEGIN PERFORM _dedupe_ref_count(gen_random_uuid()); RAISE EXCEPTION 'expected missing';
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'linked_table_missing%' THEN RAISE; END IF; END $$;
-- Salon users cannot call it.
DO $$ BEGIN ASSERT NOT has_function_privilege('authenticated','dedupe_apply(uuid,boolean)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','dedupe_preview(uuid)','EXECUTE'); END $$;
SELECT 'ALL DEDUPE SIMULATION ASSERTS PASSED';
