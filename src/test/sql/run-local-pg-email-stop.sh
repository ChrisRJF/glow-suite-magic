#!/usr/bin/env bash
# Throwaway local PostgreSQL (no TCP, private socket, destroyed afterwards). Applies the PROPOSED
# customer_email_controls migration and drives the real secured email handler against it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BASE=/tmp/glowsuite-pg-email-stop
RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
PSQLX="psql -X -q -v ON_ERROR_STOP=1 -h $BASE/sock -U testsuper"
AS $PSQLX -d postgres -c "create database gs_email_stop" >/dev/null
cp "$ROOT/docs/proposed-migrations/2026-10-10_customer_email_controls.sql" "$BASE/m.sql"; chown $RUNUID "$BASE/m.sql"
AS $PSQLX -d gs_email_stop -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;" >/dev/null
AS $PSQLX -d gs_email_stop -c "select 'listen='''||current_setting('listen_addresses')||''' db='||current_database()" -At
AS $PSQLX -d gs_email_stop -f "$BASE/m.sql"
AS $PSQLX -d gs_email_stop -f "$BASE/m.sql"   # idempotent re-apply
cd "$ROOT"
AS env PATH="$PATH" HOME=/tmp PSQLX="$PSQLX" bun "$HERE/customer-email-stop-e2e.ts"
