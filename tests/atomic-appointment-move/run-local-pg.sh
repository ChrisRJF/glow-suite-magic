#!/usr/bin/env bash
# Throwaway local PostgreSQL (no TCP, private socket, deleted afterwards).
# Applies the PROPOSED atomic move RPC to a fictional fixture and runs the tests,
# including a two-session race. Never touches the project database.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
BASE=/tmp/glowsuite-pg-atomic-move; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
cp "$ROOT/docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql" "$ROOT/docs/proposed-migrations/2026-10-10_atomic_appointment_activate_booking.sql" "$ROOT/docs/proposed-migrations/2026-10-10_atomic_appointment_activate_agenda.sql" "$ROOT/docs/proposed-migrations/2026-10-10_appointment_slot_guard.sql" "$HERE"/*.sql "$BASE/"
chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
P="psql -X -q -At -h $BASE/sock -U testsuper"
AS $P -d postgres -c "create database gs_move" >/dev/null
AS $P -d gs_move -c "select 'isolated: listen='''||current_setting('listen_addresses')||''' db='||current_database()"
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/fixture.sql"
M=$BASE/2026-10-10_atomic_appointment_move.sql
# ---- T: transaction safety of step 1 (before the real apply) ----
SNAP="select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,'-')||md5(p.prosrc),'|' order by 1)) from pg_proc p where pronamespace='public'::regnamespace"
TSNAP="select md5(string_agg(table_name||'.'||column_name||':'||data_type||coalesce(column_default,''),'|' order by 1)) from information_schema.columns where table_schema='public'"
NEWF="select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('amsterdam_wall_to_utc','minutes_to_wall_time','appointment_busy_candidates','appointment_slot_check','move_appointment_atomic','create_appointment_atomic','create_public_booking_atomic')"
COL="select count(*) from information_schema.columns where table_name='tenant_feature_flags' and column_name='atomic_agenda_enabled'"
AS $P -d gs_move -c "select p.oid::regprocedure::text||coalesce(p.proacl::text,'-') from pg_proc p where pronamespace='public'::regnamespace order by 1" > $BASE/f0.txt; F0=$(AS $P -d gs_move -c "$SNAP"); T0=$(AS $P -d gs_move -c "$TSNAP"); D0=$(AS $P -d gs_move -c "select md5(string_agg((to_jsonb(t)-'atomic_agenda_enabled')::text,'|' order by (to_jsonb(t)-'atomic_agenda_enabled')::text)) from tenant_feature_flags t")
ok() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (got '$2' want '$3')"; fi; }
# T01 autocommit run refused, nothing created
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $M" >/dev/null 2>&1 && echo "FAIL: T01 autocommit allowed" || echo "PASS: T01 run outside one transaction refused"
ok "T01 nothing created after refused run" "$(AS $P -d gs_move -c "$NEWF")/$(AS $P -d gs_move -c "$COL")" "0/0"
# T02 forced error mid-file (after column + first functions) rolls back everything
python3 - "$M" "$BASE/mid.sql" <<'PY'
import sys; s=open(sys.argv[1]).read(); k=s.index('CREATE OR REPLACE FUNCTION public.appointment_slot_check(')
open(sys.argv[2],'w').write(s[:k]+"DO $x$ BEGIN RAISE EXCEPTION 'injected mid-migration failure'; END $x$;\n"+s[k:])
PY
chown $RUNUID "$BASE/mid.sql"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/mid.sql" >/dev/null 2>&1 && echo "FAIL: T02 injected error ignored" || echo "PASS: T02 injected mid-migration error aborts"
ok "T02 rollback: no new functions, no new column" "$(AS $P -d gs_move -c "$NEWF")/$(AS $P -d gs_move -c "$COL")" "0/0"
# T03 failure at the final verification step (simulated stray grant) rolls back everything
python3 - "$M" "$BASE/late.sql" <<'PY'
import sys; s=open(sys.argv[1]).read(); k=s.index('-- 6. final verification')
open(sys.argv[2],'w').write(s[:k]+"GRANT EXECUTE ON FUNCTION public.minutes_to_wall_time(int) TO anon;\n"+s[k:])
PY
chown $RUNUID "$BASE/late.sql"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/late.sql" >/dev/null 2>&1 && echo "FAIL: T03 stray grant passed" || echo "PASS: T03 catalog check catches a stray EXECUTE grant before commit"
ok "T03 rollback after late failure" "$(AS $P -d gs_move -c "$NEWF")/$(AS $P -d gs_move -c "$COL")" "0/0"
# T04 uncommitted functions invisible + not callable from another session; T05 nothing executable at commit
printf 'BEGIN;\n\\i %s\nSELECT pg_sleep(3);\nCOMMIT;\n' "$M" > "$BASE/hold.sql"; chown $RUNUID "$BASE/hold.sql"
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/hold.sql >/dev/null 2>&1 &
  sleep 1.5
  echo \"V=\$($P -d gs_move -c \"$NEWF\")/\$($P -d gs_move -c \"$COL\")\"
  $P -d gs_move -c \"select public.minutes_to_wall_time(60)\" >/dev/null 2>&1 && echo CALL=yes || echo CALL=no
  wait" > "$BASE/vis.out"
ok "T04 during open transaction other session sees 0 functions / 0 column" "$(grep '^V=' $BASE/vis.out)" "V=0/0"
ok "T04 other session cannot call uncommitted function" "$(grep '^CALL=' $BASE/vis.out)" "CALL=no"
ok "T05 after commit all 7 functions and column exist" "$(AS $P -d gs_move -c "$NEWF")/$(AS $P -d gs_move -c "$COL")" "7/1"
R=$(AS $P -d gs_move -c "select count(*) from pg_proc p, unnest(array['anon','authenticated','service_role']) r where pronamespace='public'::regnamespace and proname in ('amsterdam_wall_to_utc','minutes_to_wall_time','appointment_busy_candidates','appointment_slot_check','move_appointment_atomic','create_appointment_atomic','create_public_booking_atomic') and has_function_privilege(r,p.oid,'EXECUTE')")
ok "T05 has_function_privilege: anon/authenticated/service_role execute none" "$R" "0"
ok "T05 pg_proc ACL: PUBLIC has no EXECUTE" "$(AS $P -d gs_move -c "select count(*) from pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where pronamespace='public'::regnamespace and proname like '%atomic%' and a.grantee=0")" "0"
ok "T06 flag off for every salon and default false" "$(AS $P -d gs_move -c "select count(*) filter (where atomic_agenda_enabled)||'/'||(select column_default from information_schema.columns where table_name='tenant_feature_flags' and column_name='atomic_agenda_enabled') from tenant_feature_flags")" "0/false"
F1=$(AS $P -d gs_move -c "select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,'-')||md5(p.prosrc),'|' order by 1)) from pg_proc p where pronamespace='public'::regnamespace and proname not in ('amsterdam_wall_to_utc','minutes_to_wall_time','appointment_busy_candidates','appointment_slot_check','move_appointment_atomic','create_appointment_atomic','create_public_booking_atomic')")
AS $P -d gs_move -c "select p.oid::regprocedure::text||coalesce(p.proacl::text,'-') from pg_proc p where pronamespace='public'::regnamespace order by 1" > $BASE/f1.txt; diff $BASE/f0.txt $BASE/f1.txt | head; ok "T07 existing functions (source + ACL) unchanged" "$F1" "$F0"
ok "T07 existing table columns unchanged" "$(AS $P -d gs_move -c "select md5(string_agg(table_name||'.'||column_name||':'||data_type||coalesce(column_default,''),'|' order by 1)) from information_schema.columns where table_schema='public' and not (table_name='tenant_feature_flags' and column_name='atomic_agenda_enabled')")" "$T0"
ok "T07 existing flag rows unchanged apart from new column" "$(AS $P -d gs_move -c "select md5(string_agg((to_jsonb(t)-'atomic_agenda_enabled')::text,'|' order by (to_jsonb(t)-'atomic_agenda_enabled')::text)) from tenant_feature_flags t")" "$D0"
AS $P -d gs_move -c "select 1" >/dev/null
# (T05 already applied step 1 once inside a held transaction)
# apply the proposal; a second apply must be REFUSED unless replacement is explicitly reviewed
if AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_move.sql" >/dev/null 2>&1; then echo "FAIL: P01 silent re-apply allowed"; else echo "PASS: P01 re-apply without review refused (existing functions not silently replaced)"; fi
AS bash -c "PGOPTIONS='-c glowsuite.allow_replace=on' $P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_move.sql" >/dev/null && echo "PASS: P01 reviewed re-apply (allow_replace=on) succeeds and is idempotent"
# step 1 only: nobody may call anything
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/tests-grants-pre.sql 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //'
# activation steps (separately approved in real life)
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_activate_booking.sql -f $BASE/2026-10-10_atomic_appointment_activate_agenda.sql" >/dev/null
AS $P -d gs_move -c "update tenant_feature_flags set atomic_agenda_enabled=true" >/dev/null
echo "activation simulated"
for F in tests.sql tests-phase2.sql tests-phase3.sql tests-phase4.sql; do
  AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/$F 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //'
done

# ---- guard (step 4 migration) applied, then all RPC suites again + guard tests ----
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_appointment_slot_guard.sql -f $BASE/2026-10-10_appointment_slot_guard.sql" >/dev/null
echo "guard applied twice"
for F in tests-guard.sql tests.sql tests-phase2.sql tests-phase3.sql tests-phase4.sql; do
  AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/$F 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //' | sed "s/^PASS: /PASS: [guard] /"
done

# Race: two sessions move different appointments into overlapping EA slots (Fri 16 Oct)
AS bash -c "$P -d gs_move -f $BASE/race-s1.sql > $BASE/s1.out 2>&1 & sleep 0.5; $P -d gs_move -f $BASE/race-s2.sql > $BASE/s2.out 2>&1; wait"
S1=$(grep -h 's1:' "$BASE/s1.out" || true); S2=$(grep -h 's2:' "$BASE/s2.out" || true)
echo "race $S1 $S2"
if [ "$S1" = "s1:moved" ] && [ "$S2" = "s2:conflict" ]; then echo "PASS: R01 concurrent overlapping moves: only one succeeds"; else echo "FAIL: R01 race"; fi
N=$(AS $P -d gs_move -c "select count(*) from appointments where id in ('a1000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000007') and (start_time, start_time + interval '60 min') overlaps ('10:00'::time,'11:30'::time)")
[ "$N" = "1" ] && echo "PASS: R01 database holds exactly one of the two" || echo "FAIL: R01 rows=$N"

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
group() { echo "SELECT '$1:'||(public.create_appointment_atomic(NULL,'$SV','$2','$3',ARRAY['$EA']::uuid[],'','manual',NULL,NULL,'[{\"person_name\":\"X\",\"service_id\":\"$SV\",\"time\":\"$4\",\"employee_id\":\"$EB\"}]')->>'code');"; }
create() { echo "SELECT '$1:'||(public.create_appointment_atomic(NULL,'$SV','$2','$3',ARRAY['$EA']::uuid[],'','manual',NULL,NULL,NULL)->>'code');"; }
race "R06 online booking 10:00 vs agenda create 10:30" "$SRV" "$(book s1 2026-10-27 10:00)" "$OWN" "$(create s2 2026-10-27 10:30)" booked conflict
race "R07 agenda create 10:00 vs move to 10:15" "$OWN" "$(create s1 2026-10-28 10:00)" "$OWN" "$(move s2 $A7 2026-10-28 10:15)" created conflict
race "R08 agenda create 14:00 vs agenda create 14:45" "$OWN" "$(create s1 2026-10-26 14:00)" "$OWN" "$(create s2 2026-10-26 14:45)" created conflict
EB=e0000000-0000-0000-0000-00000000000b
race "R09 two group bookings, overlapping members" "$OWN" "$(group s1 2026-11-02 09:00 10:00)" "$OWN" "$(group s2 2026-11-02 11:00 10:30)" created conflict
CNT() { AS $P -d gs_move -c "$1"; }
[ "$(CNT "select count(*) from appointments where employee_id='$EA' and start_time in ('13:00','13:30') and (appointment_date at time zone 'Europe/Amsterdam')::date='2026-10-15'")" = "1" ] && echo "PASS: R02 database holds one" || echo "FAIL: R02 rows"
[ "$(CNT "select count(*) from appointments where employee_id='$EA' and start_time in ('14:00','14:30') and (appointment_date at time zone 'Europe/Amsterdam')::date='2026-10-22'")" = "1" ] && echo "PASS: R03 database holds one" || echo "FAIL: R03 rows"
[ "$(CNT "select count(*) from appointments where employee_id='$EA' and start_time in ('10:00','10:15') and (appointment_date at time zone 'Europe/Amsterdam')::date='2026-10-23'")" = "1" ] && echo "PASS: R04 database holds one" || echo "FAIL: R04 rows"
[ "$(CNT "select (appointment_date at time zone 'Europe/Amsterdam')::date::text from appointments where id='$A6'")" = "2026-10-29" ] && echo "PASS: R05 first move kept, second not applied" || echo "FAIL: R05 state"
for d in 2026-10-27 2026-10-28 2026-10-26; do
  N=$(CNT "select count(*) from appointments where employee_id='$EA' and status<>'geannuleerd' and (appointment_date at time zone 'Europe/Amsterdam')::date='$d' and start_time>='10:00' and start_time<'15:00'")
  [ "$N" = "1" ] && echo "PASS: R06-R08 $d database holds one" || echo "FAIL: R06-R08 $d rows=$N"
done
N=$(CNT "select count(*) from appointments where (appointment_date at time zone 'Europe/Amsterdam')::date='2026-11-02' and booking_group_id is not null")
[ "$N" = "2" ] && echo "PASS: R09 only the first group (2 rows) stored" || echo "FAIL: R09 rows=$N"
