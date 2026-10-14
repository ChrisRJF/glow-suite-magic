#!/usr/bin/env bash
# Throwaway local PostgreSQL with synthetic data; never touches the project database.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
BASE=/tmp/gs-pg-commission; U=$(id -u lovable 2>/dev/null || echo 4711)
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; cp "$ROOT/docs/proposed-migrations/2026-10-14_isv_commission_separation.sql" "$HERE/commission-separation-tests.sql" "$BASE/"; chown -R $U:$U "$BASE"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$U --regid=$U --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U postgres -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
P="psql -X -q -At -h $BASE/sock -U postgres -d postgres"
# Stub of the existing live shape: payments RLS (own tenant + finance role), audit_logs, payment_ledger, auth helpers.
AS $P -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO PUBLIC;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('aal', current_setting('test.aal', true)) $$;
CREATE TABLE payments (id uuid PRIMARY KEY, user_id uuid, amount numeric, is_demo boolean, provider text, status text, metadata jsonb DEFAULT '{}');
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO authenticated; GRANT ALL ON payments TO service_role;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel ON payments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ins ON payments FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY upd ON payments FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TABLE payment_ledger (tenant_id uuid, payment_id uuid, kind text, amount_cents int, is_demo boolean, created_at timestamptz);
CREATE TABLE audit_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid NOT NULL, actor_user_id uuid, action text NOT NULL, target_type text NOT NULL, target_id text, details jsonb NOT NULL, is_demo boolean NOT NULL, created_at timestamptz DEFAULT now());
SQL
AS $P -1 -v ON_ERROR_STOP=1 -f "$BASE/2026-10-14_isv_commission_separation.sql" >/dev/null || echo "FAIL: migration"
OUT=$(AS psql -X -At -h $BASE/sock -U postgres -d postgres -f "$BASE/commission-separation-tests.sql" 2>&1)
AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null; rm -rf "$BASE"
echo "$OUT" | sed 's/^.*NOTICE:  //'
echo "SUMMARY pass=$(echo "$OUT" | grep -c 'PASS:') fail=$(echo "$OUT" | grep -cE 'FAIL|ERROR')"
