#!/usr/bin/env bash
# Throwaway local PostgreSQL (no TCP, private socket, deleted afterwards).
# Applies the PROPOSED atomic move RPC to a fictional fixture and runs the tests,
# including a two-session race. Never touches the project database.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
BASE=/tmp/glowsuite-pg-atomic-move; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
cp "$ROOT/docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql" "$ROOT/docs/proposed-migrations/2026-10-10_appointment_slot_guard.sql" "$HERE"/*.sql "$BASE/"
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
for F in tests.sql tests-phase2.sql tests-phase3.sql; do
  AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/$F 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //'
done

# Race: two sessions move different appointments into overlapping EA slots (Fri 16 Oct)
AS bash -c "$P -d gs_move -f $BASE/race-s1.sql > $BASE/s1.out 2>&1 & sleep 0.5; $P -d gs_move -f $BASE/race-s2.sql > $BASE/s2.out 2>&1; wait"
S1=$(grep -h 's1:' "$BASE/s1.out" || true); S2=$(grep -h 's2:' "$BASE/s2.out" || true)
echo "race $S1 $S2"
if [ "$S1" = "s1:moved" ] && [ "$S2" = "s2:conflict" ]; then echo "PASS: R01 concurrent overlapping moves: only one succeeds"; else echo "FAIL: R01 race"; fi
N=$(AS $P -d gs_move -c "select count(*) from appointments where id in ('a1000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000007') and (start_time, start_time + interval '60 min') overlaps ('10:00'::time,'11:30'::time)")
[ "$N" = "1" ] && echo "PASS: R01 database holds exactly one of the two" || echo "FAIL: R01 rows=$N"

# ---- guard (step 4 migration) applied, then all RPC suites again + guard tests ----
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_appointment_slot_guard.sql -f $BASE/2026-10-10_appointment_slot_guard.sql" >/dev/null
echo "guard applied twice"
for F in tests-guard.sql tests.sql tests-phase2.sql tests-phase3.sql; do
  AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/$F 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //' | sed "s/^PASS: /PASS: [guard] /"
done

# ---- fase 2 races: s1 holds its transaction 2 s, s2 starts 0.5 s later ----
OWN="SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true); SET LOCAL ROLE authenticated;"
SRV="SET LOCAL ROLE service_role;"
CM='{"customer_id":"c0000000-0000-0000-0000-000000000001"}'
SV=a0000000-0000-0000-0000-000000000060; EA=e0000000-0000-0000-0000-00000000000a
book() { echo "SELECT '$1:'||(public.create_public_booking_atomic('salon-een','$2','[{\"time\":\"$3\",\"service_id\":\"$SV\",\"employee_id\":\"$EA\"}]','$CM')->>'code');"; }
move() { echo "SELECT '$1:'||(public.move_appointment_atomic('$2','$3','$4','$EA',public.t_upd('$2'))->>'code');"; }
race() { # name role1 sql1 role2 sql2 expect1 expect2
  printf 'BEGIN;\n%s\n%s\nSELECT pg_sleep(2);\nCOMMIT;\n' "$2" "$3" > "$BASE/r1.sql"
  printf 'BEGIN;\n%s\n%s\nCOMMIT;\n' "$4" "$5" > "$BASE/r2.sql"
  chown $RUNUID "$BASE/r1.sql" "$BASE/r2.sql"
  AS bash -c "$P -d gs_move -f $BASE/r1.sql > $BASE/o1 2>&1 & sleep 0.5; $P -d gs_move -f $BASE/r2.sql > $BASE/o2 2>&1; wait"
  local a b; a=$(grep -h 's1:' "$BASE/o1" || true); b=$(grep -h 's2:' "$BASE/o2" || true)
  if [ "$a" = "s1:$6" ] && [ "$b" = "s2:$7" ]; then echo "PASS: $1 ($a $b)"; else echo "FAIL: $1 ($a $b)"; cat "$BASE/o1" "$BASE/o2"; fi
}
A7=a1000000-0000-0000-0000-000000000007; A6=a1000000-0000-0000-0000-000000000006
race "R02 booking 13:00 holds lock, move to 13:30 same employee" "$SRV" "$(book s1 2026-10-15 13:00)" "$OWN" "$(move s2 $A7 2026-10-15 13:30)" booked conflict
race "R03 move to 14:00 holds lock, booking 14:30 same employee" "$OWN" "$(move s1 $A7 2026-10-22 14:00)" "$SRV" "$(book s2 2026-10-22 14:30)" moved conflict
race "R04 booking 10:00 vs booking 10:15 same employee" "$SRV" "$(book s1 2026-10-23 10:00)" "$SRV" "$(book s2 2026-10-23 10:15)" booked conflict
race "R05 two moves of same appointment, same version (different days)" "$OWN" "$(move s1 $A6 2026-10-29 10:00)" "$OWN" "$(move s2 $A6 2026-10-30 14:00)" moved stale
create() { echo "SELECT '$1:'||(public.create_appointment_atomic(NULL,'$SV','$2','$3',ARRAY['$EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code');"; }
race "R06 online booking 10:00 vs agenda create 10:30" "$SRV" "$(book s1 2026-10-27 10:00)" "$OWN" "$(create s2 2026-10-27 10:30)" booked conflict
race "R07 agenda create 10:00 vs move to 10:15" "$OWN" "$(create s1 2026-10-28 10:00)" "$OWN" "$(move s2 $A7 2026-10-28 10:15)" created conflict
race "R08 agenda create 14:00 vs agenda create 14:45" "$OWN" "$(create s1 2026-10-26 14:00)" "$OWN" "$(create s2 2026-10-26 14:45)" created conflict
CNT() { AS $P -d gs_move -c "$1"; }
[ "$(CNT "select count(*) from appointments where employee_id='$EA' and start_time in ('13:00','13:30') and (appointment_date at time zone 'Europe/Amsterdam')::date='2026-10-15'")" = "1" ] && echo "PASS: R02 database holds one" || echo "FAIL: R02 rows"
[ "$(CNT "select count(*) from appointments where employee_id='$EA' and start_time in ('14:00','14:30') and (appointment_date at time zone 'Europe/Amsterdam')::date='2026-10-22'")" = "1" ] && echo "PASS: R03 database holds one" || echo "FAIL: R03 rows"
[ "$(CNT "select count(*) from appointments where employee_id='$EA' and start_time in ('10:00','10:15') and (appointment_date at time zone 'Europe/Amsterdam')::date='2026-10-23'")" = "1" ] && echo "PASS: R04 database holds one" || echo "FAIL: R04 rows"
[ "$(CNT "select (appointment_date at time zone 'Europe/Amsterdam')::date::text from appointments where id='$A6'")" = "2026-10-29" ] && echo "PASS: R05 first move kept, second not applied" || echo "FAIL: R05 state"
for d in 2026-10-27 2026-10-28 2026-10-26; do
  N=$(CNT "select count(*) from appointments where employee_id='$EA' and status<>'geannuleerd' and (appointment_date at time zone 'Europe/Amsterdam')::date='$d' and start_time>='10:00' and start_time<'15:00'")
  [ "$N" = "1" ] && echo "PASS: R06-R08 $d database holds one" || echo "FAIL: R06-R08 $d rows=$N"
done
