#!/usr/bin/env bash
# Throwaway local PostgreSQL (no TCP, private socket, destroyed afterwards). Synthetic data only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
BASE=/tmp/glowsuite-pg-dedupe; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
P="psql -X -q -v ON_ERROR_STOP=1 -h $BASE/sock -U testsuper"
AS $P -d postgres -c "create database gs_dedupe" >/dev/null
for f in "$HERE/customer-dedupe-sim.sql" "$ROOT/docs/proposed-migrations/2026-10-10_customer_dedupe_exact_pairs.sql" "$HERE/customer-dedupe-sim-tests.sql"; do cp "$f" "$BASE/"; done
chown $RUNUID "$BASE"/*.sql
AS $P -d gs_dedupe -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;" >/dev/null
AS $P -d gs_dedupe -At -c "select 'listen='''||current_setting('listen_addresses')||''''"
AS $P -d gs_dedupe -f "$BASE/customer-dedupe-sim.sql"
AS $P -d gs_dedupe -f "$BASE/2026-10-10_customer_dedupe_exact_pairs.sql"
AS $P -d gs_dedupe -f "$BASE/2026-10-10_customer_dedupe_exact_pairs.sql"   # idempotent re-apply
AS $P -d gs_dedupe -At -1 -f "$BASE/customer-dedupe-sim-tests.sql"
