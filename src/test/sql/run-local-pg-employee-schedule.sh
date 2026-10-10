#!/usr/bin/env bash
# Throwaway local PostgreSQL (no TCP, private socket, destroyed afterwards). Applies the PROPOSED
# employee weekly schedule migration twice and checks it with fictional data.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
BASE=/tmp/glowsuite-pg-employee-schedule; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; cp "$ROOT/docs/proposed-migrations/2026-10-10_employee_weekly_schedule.sql" "$HERE"/employee-schedule-migration*.sql "$BASE/"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
P="psql -X -q -At -h $BASE/sock -U testsuper"
AS $P -d postgres -c "create database gs_sched" >/dev/null
AS $P -d gs_sched -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role; grant usage on schema public to authenticated;"
AS $P -d gs_sched -c "select 'isolated: listen='''||current_setting('listen_addresses')||''' db='||current_database()"
AS bash -c "cat $BASE/employee-schedule-migration.sql $BASE/2026-10-10_employee_weekly_schedule.sql $BASE/2026-10-10_employee_weekly_schedule.sql $BASE/employee-schedule-migration-checks.sql | $P -d gs_sched -v ON_ERROR_STOP=1 2>&1"
echo "migration applied twice (idempotent)"
