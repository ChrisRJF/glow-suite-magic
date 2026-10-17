#!/usr/bin/env bash
# Throwaway local PostgreSQL (private socket, deleted afterwards), fictional data only.
# Applies live step-1 SQL + 3A, then the PROPOSED move_appointment_atomic_as, runs SQL tests and two-session races.
set -euo pipefail
LOG=$(mktemp /tmp/move-as-log.XXXXXX); exec > >(tee "$LOG") 2>&1
finish() { local rc=$?; AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"
  local np nf; np=$(grep -c '^PASS' "$LOG" || true); nf=$(grep -cE '^FAIL|ERROR' "$LOG" || true)
  echo "SUMMARY: pass=$np fail=$nf"; rm -f "$LOG"; if [ "$rc" -ne 0 ] || [ "$nf" -ne 0 ] || [ "$np" -eq 0 ]; then exit 1; fi; exit 0; }
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; PM="$ROOT/docs/proposed-migrations"
BASE=/tmp/glowsuite-pg-move-as; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
cp "$PM"/2026-10-10_atomic_appointment_*.sql "$PM/2026-10-11_agenda_create_route.sql" "$PM/2026-10-17_move_appointment_atomic_as.sql" "$HERE"/fixture.sql "$HERE"/tests-move-as.sql "$BASE/"
chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap finish EXIT
P="psql -X -q -At -h $BASE/sock -U testsuper"; Q() { AS $P -d gs_move -c "$1"; }
ok() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (got '$2' want '$3')"; fi; }
AS $P -d postgres -c "create database gs_move" >/dev/null
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/fixture.sql" >/dev/null
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_move.sql" >/dev/null
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_activate_booking.sql" >/dev/null
Q "CREATE TABLE public.user_access (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL, member_user_id uuid, role public.app_role NOT NULL, status text NOT NULL DEFAULT 'active', is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO public.user_access (owner_user_id, member_user_id, role) VALUES
 ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','medewerker'),
 ('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','receptie'),
 ('11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','receptie'),
 ('22222222-2222-2222-2222-222222222222','66666666-6666-6666-6666-666666666666','receptie');
 INSERT INTO public.tenant_feature_flags (tenant_id) VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222') ON CONFLICT DO NOTHING;" >/dev/null
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-11_agenda_create_route.sql" >/dev/null
# Production state checked read-only 2026-10-17: authenticated has NO EXECUTE on move_appointment_atomic, so the agenda activation file is not applied.
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-17_move_appointment_atomic_as.sql" >/dev/null && echo "PASS: W00 proposed wrapper applies in one transaction (local only)"
Q "update tenant_feature_flags set atomic_agenda_enabled=true" >/dev/null
ok "W01 authenticated call is denied" "$(AS $P -d gs_move -c "set role authenticated; select public.move_appointment_atomic_as('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','2026-11-02','10:00',NULL,now())" 2>&1 | grep -c 'permission denied')" "1"
AS bash -c "$P -d gs_move -f $BASE/tests-move-as.sql 2>&1" | { grep -E "PASS|FAIL" || true; } | sed 's/^psql:[^:]*:[0-9]*: //'
# ---- races ----
race() { echo "$1" > "$BASE/s1.sql"; echo "$2" > "$BASE/s2.sql"; chown $RUNUID "$BASE"/s?.sql
  AS bash -c "$P -d gs_move -f $BASE/s1.sql > $BASE/s1.out 2>&1 & sleep 0.5; $P -d gs_move -f $BASE/s2.sql > $BASE/s2.out 2>&1; wait"; cat "$BASE/s1.out" "$BASE/s2.out" >> "$BASE/race.log"; cat "$BASE/s1.out" "$BASE/s2.out" | { grep -E "^s[12]" || true; } | tr '\n' ' '; }
mv1() { echo "BEGIN; SET LOCAL ROLE service_role; SELECT '$1:'||(public.move_appointment_atomic_as('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','2026-11-02','$2','e0000000-0000-0000-0000-00000000000b',(SELECT updated_at FROM appointments WHERE id='b1000000-0000-0000-0000-000000000001'))->>'code'); SELECT pg_sleep($3); COMMIT;"; }
R=$(race "$(mv1 s1 10:00 2)" "$(mv1 s2 11:00 0)")
echo "RACE1: $R"; ok "X01 two concurrent moves of one row: first moved, second stale (read before commit)" "$(echo "$R" | grep -o 's1:moved')/$(echo "$R" | grep -o 's2:stale')" "s1:moved/s2:stale"
ok "X01 row at first target" "$(Q "select appointment_date='2026-11-02 09:00Z' from appointments where id='b1000000-0000-0000-0000-000000000001'")" "t"
S2="SELECT clock_timestamp() AS t0 \gset
INSERT INTO sub_appointments (parent_appointment_id,user_id,person_name) VALUES ('b1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Kim');
SELECT 's2:waited:'||(extract(epoch from clock_timestamp()-:'t0'::timestamptz)>1)::text;"
R=$(race "$(mv1 s1 13:00 2)" "$S2")
ok "X02 sub_appointment insert waits for the move lock (FK key-share)" "$(echo "$R" | grep -o 's1:moved')/$(echo "$R" | grep -o 's2:waited:true')" "s1:moved/s2:waited:true"
ok "X03 after that sub exists, next move refused" "$(Q "set role service_role; select public.move_appointment_atomic_as('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','2026-11-02','10:00','e0000000-0000-0000-0000-00000000000b',(select updated_at from appointments where id='b1000000-0000-0000-0000-000000000001'))->>'code'" | tail -1)" "sub_appointments_unsupported"
S3="INSERT INTO appointment_employees (user_id,appointment_id,employee_id) VALUES ('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-00000000000a'); SELECT 's2:inserted';"
mv3="BEGIN; SET LOCAL ROLE service_role; SELECT pg_sleep(1); SELECT 's1:'||(public.move_appointment_atomic_as('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000003','2026-11-03','13:00','e0000000-0000-0000-0000-00000000000b',(SELECT updated_at FROM appointments WHERE id='b1000000-0000-0000-0000-000000000003'))->>'code'); COMMIT;"
R=$(race "$mv3" "$S3")
ok "X04 link committed concurrently before the check: move refused, links kept" "$(echo "$R" | grep -o 's1:multi_employee_unsupported')/$(Q "select count(*) from appointment_employees where appointment_id='b1000000-0000-0000-0000-000000000003'")" "s1:multi_employee_unsupported/2"
