#!/usr/bin/env bash
# Throwaway local PostgreSQL with fictional salons; never touches the project database.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
BASE=/tmp/gs-pg-kassa; U=$(id -u lovable 2>/dev/null || echo 4711)
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
cp "$ROOT/docs/proposed-migrations/2026-10-11_appointment_checkout_ledger.sql" "$ROOT/docs/proposed-migrations/2026-10-12_kassa_orders.sql" "$HERE/schema-stub.sql" "$HERE/tests.sql" "$BASE/"; chown -R $U:$U "$BASE"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$U --regid=$U --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U postgres -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
P="psql -X -q -At -h $BASE/sock -U postgres -d postgres"
AS $P -1 -v ON_ERROR_STOP=1 -f "$BASE/schema-stub.sql" >/dev/null || echo "FAIL: stub"
AS $P -1 -v ON_ERROR_STOP=1 -f "$BASE/2026-10-11_appointment_checkout_ledger.sql" >/dev/null || echo "FAIL: ledger migration"
AS $P -1 -v ON_ERROR_STOP=1 -f "$BASE/2026-10-12_kassa_orders.sql" >/dev/null || echo "FAIL: kassa migration"
OUT=$(AS $P -f "$BASE/tests.sql" 2>&1)
AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null; rm -rf "$BASE"
echo "$OUT" | sed 's/^.*NOTICE:  //' | grep -E 'PASS|FAIL|ERROR'
echo "SUMMARY pass=$(echo "$OUT" | grep -c 'PASS:') fail=$(echo "$OUT" | grep -cE 'FAIL|ERROR')"
