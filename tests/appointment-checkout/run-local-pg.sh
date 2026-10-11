#!/usr/bin/env bash
# Throwaway local PostgreSQL with fictional data; never touches the project database.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
BASE=/tmp/gs-pg-checkout; U=$(id -u lovable 2>/dev/null || echo 4711)
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; cp "$ROOT/docs/proposed-migrations/2026-10-11_appointment_checkout_ledger.sql" "$HERE/ledger-tests.sql" "$BASE/"; chown -R $U:$U "$BASE"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$U --regid=$U --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U postgres -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
P="psql -X -q -At -h $BASE/sock -U postgres -d postgres"
AS $P -v ON_ERROR_STOP=1 -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE sandbox_exec;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO sandbox_exec;
 GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, sandbox_exec;
 CREATE TABLE tenant_feature_flags (tenant_id uuid PRIMARY KEY);
 CREATE TABLE payments (id uuid PRIMARY KEY, user_id uuid, appointment_id uuid, amount numeric, is_demo boolean, provider text);" >/dev/null
AS $P -1 -v ON_ERROR_STOP=1 -f "$BASE/2026-10-11_appointment_checkout_ledger.sql" >/dev/null || echo "FAIL: migration"
OUT=$(AS $P -f "$BASE/ledger-tests.sql" 2>&1)
AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null; rm -rf "$BASE"
echo "$OUT" | sed 's/^.*NOTICE:  //'
echo "SUMMARY pass=$(echo "$OUT" | grep -c 'PASS:') fail=$(echo "$OUT" | grep -cE 'FAIL|ERROR')"
