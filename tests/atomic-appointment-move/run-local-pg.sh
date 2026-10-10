#!/usr/bin/env bash
# Throwaway local PostgreSQL (no TCP, private socket, deleted afterwards).
# Applies the PROPOSED atomic move RPC to a fictional fixture and runs the tests,
# including a two-session race. Never touches the project database.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
BASE=/tmp/glowsuite-pg-atomic-move; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
cp "$ROOT/docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql" "$HERE"/*.sql "$BASE/"
chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
P="psql -X -q -At -h $BASE/sock -U testsuper"
AS $P -d postgres -c "create database gs_move" >/dev/null
AS $P -d gs_move -c "select 'isolated: listen='''||current_setting('listen_addresses')||''' db='||current_database()"
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/fixture.sql"
# apply the proposal twice: CREATE OR REPLACE must be idempotent
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_move.sql -f $BASE/2026-10-10_atomic_appointment_move.sql"
echo "proposal applied twice"
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/tests.sql 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //'

# Race: two sessions move different appointments into overlapping EA slots (Fri 16 Oct)
AS bash -c "$P -d gs_move -f $BASE/race-s1.sql > $BASE/s1.out 2>&1 & sleep 0.5; $P -d gs_move -f $BASE/race-s2.sql > $BASE/s2.out 2>&1; wait"
S1=$(grep -h 's1:' "$BASE/s1.out" || true); S2=$(grep -h 's2:' "$BASE/s2.out" || true)
echo "race $S1 $S2"
if [ "$S1" = "s1:moved" ] && [ "$S2" = "s2:conflict" ]; then echo "PASS: R01 concurrent overlapping moves: only one succeeds"; else echo "FAIL: R01 race"; fi
N=$(AS $P -d gs_move -c "select count(*) from appointments where id in ('a1000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000007') and (start_time, start_time + interval '60 min') overlaps ('10:00'::time,'11:30'::time)")
[ "$N" = "1" ] && echo "PASS: R01 database holds exactly one of the two" || echo "FAIL: R01 rows=$N"
