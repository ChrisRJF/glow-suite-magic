#!/usr/bin/env bash
# Step 3A: throwaway local PostgreSQL (private socket, deleted afterwards), fictional data only.
# Applies the live step-1 SQL + activation grants, then the PROPOSED 3A migration, runs existing suites,
# the 3A suite and real two-session races. Never touches the project database.
set -euo pipefail
LOG=$(mktemp /tmp/atomic-3a-log.XXXXXX); exec > >(tee "$LOG") 2>&1
finish() { local rc=$?; AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"
  local np nf; np=$(grep -c '^PASS' "$LOG" || true); nf=$(grep -cE '^FAIL|ERROR' "$LOG" || true)
  echo "SUMMARY: pass=$np fail=$nf"; rm -f "$LOG"; if [ "$rc" -ne 0 ] || [ "$nf" -ne 0 ] || [ "$np" -eq 0 ]; then exit 1; fi; exit 0; }
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; PM="$ROOT/docs/proposed-migrations"
BASE=/tmp/glowsuite-pg-3a; RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
cp "$PM"/2026-10-10_atomic_appointment_*.sql "$PM/2026-10-11_agenda_create_route.sql" "$PM/2026-10-11_agenda_create_requests_grants_fix.sql" "$HERE"/*.sql "$BASE/"
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
AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/2026-10-10_atomic_appointment_activate_booking.sql -f $BASE/2026-10-10_atomic_appointment_activate_agenda.sql" >/dev/null
# fictional salon memberships (structure as live user_access)
Q "CREATE TABLE public.user_access (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL, member_user_id uuid, role public.app_role NOT NULL, status text NOT NULL DEFAULT 'active', is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO public.user_access (owner_user_id, member_user_id, role) VALUES
 ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','medewerker'),
 ('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','receptie'),
 ('11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','receptie'),
 ('22222222-2222-2222-2222-222222222222','66666666-6666-6666-6666-666666666666','receptie');
 INSERT INTO public.tenant_feature_flags (tenant_id) VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222') ON CONFLICT DO NOTHING;" >/dev/null
# emulate production default table privileges (pg_default_acl of the migration role in public)
Q "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN CREATE ROLE sandbox_exec NOLOGIN; END IF; END \$\$;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO sandbox_exec;" >/dev/null
SNAP="select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,'-')||md5(p.prosrc),'|' order by p.oid::regprocedure::text)) from pg_proc p where pronamespace='public'::regnamespace and proname not in ('create_appointment_atomic_as','agenda_actor_tenant')"
TSNAP="select md5(string_agg(table_name||'.'||column_name||':'||data_type||coalesce(column_default,''),'|' order by table_name,column_name)) from information_schema.columns where table_schema='public' and table_name<>'agenda_create_requests'"
F0=$(Q "$SNAP"); T0=$(Q "$TSNAP")
# M01 forced failure at the end rolls back the whole 3A migration
python3 - "$BASE/2026-10-11_agenda_create_route.sql" "$BASE/bad.sql" <<'PY'
import sys; s=open(sys.argv[1]).read(); k=s.index('-- final verification')
open(sys.argv[2],'w').write(s[:k]+"GRANT EXECUTE ON FUNCTION public.agenda_actor_tenant(uuid) TO authenticated;\n"+s[k:])
PY
chown $RUNUID "$BASE/bad.sql"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/bad.sql" >/dev/null 2>&1 && echo "FAIL: M01 stray grant passed" || echo "PASS: M01 stray grant aborts migration"
ok "M01 nothing left after abort" "$(Q "select count(*) from pg_proc where proname in ('create_appointment_atomic_as','agenda_actor_tenant')")/$(Q "select count(*) from pg_class where relname='agenda_create_requests'")" "0/0"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-11_agenda_create_route.sql" >/dev/null && echo "PASS: M02 3A migration applies in one transaction"
ok "M03 existing functions (source + ACL) unchanged" "$(Q "$SNAP")" "$F0"
ok "M03 existing table columns unchanged" "$(Q "$TSNAP")" "$T0"
ok "M04 flags still off after migration" "$(Q "select count(*) filter (where atomic_agenda_enabled) from tenant_feature_flags")" "0"
# ---- G: table privileges (production default privileges reproduced) ----
TP() { Q "select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p where has_table_privilege('$1','public.agenda_create_requests',p)"; }
ok "G01 reproduces production: service_role has UPDATE before fix" "$(Q "select has_table_privilege('service_role','public.agenda_create_requests','UPDATE')")" "t"
ok "G01 reproduces production: sandbox_exec has SELECT,INSERT" "$(TP sandbox_exec)" "INSERT,SELECT"
python3 - "$BASE/2026-10-11_agenda_create_requests_grants_fix.sql" "$BASE/badfix.sql" <<'PY2'
import sys; s=open(sys.argv[1]).read(); k=s.index('-- Final verification')
open(sys.argv[2],'w').write(s[:k]+"GRANT UPDATE ON public.agenda_create_requests TO service_role;\n"+s[k:])
PY2
chown $RUNUID "$BASE/badfix.sql"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/badfix.sql" >/dev/null 2>&1 && echo "FAIL: G02 bad fix passed" || echo "PASS: G02 fix self-check aborts on stray UPDATE"
for BAD in "GRANT TRUNCATE ON public.agenda_create_requests TO service_role;" "GRANT REFERENCES ON public.agenda_create_requests TO service_role;" "GRANT TRIGGER ON public.agenda_create_requests TO service_role;" "GRANT MAINTAIN ON public.agenda_create_requests TO service_role;" "GRANT SELECT ON public.agenda_create_requests TO PUBLIC;" "GRANT DELETE ON public.agenda_create_requests TO authenticated;" "CREATE ROLE gs_inherit_probe NOLOGIN; GRANT UPDATE ON public.agenda_create_requests TO gs_inherit_probe; GRANT gs_inherit_probe TO service_role;" "CREATE ROLE gs_inherit_probe2 NOLOGIN; GRANT INSERT ON public.agenda_create_requests TO gs_inherit_probe2; GRANT gs_inherit_probe2 TO anon;" "REVOKE DELETE ON public.agenda_create_requests FROM service_role;"; do
  python3 - "$BASE/2026-10-11_agenda_create_requests_grants_fix.sql" "$BASE/badfix.sql" "$BAD" <<'PY2'
import sys; s=open(sys.argv[1]).read(); k=s.index('-- Final verification')
open(sys.argv[2],'w').write(s[:k]+sys.argv[3]+"\n"+s[k:])
PY2
  chown $RUNUID "$BASE/badfix.sql"
  AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/badfix.sql" >/dev/null 2>&1 && echo "FAIL: G02 stray right passed: $BAD" || echo "PASS: G02 single stray right stops + rolls back: ${BAD:0:60}"
done
ok "G02 rollback left no probe roles" "$(Q "select count(*) from pg_roles where rolname like 'gs_inherit_probe%'")" "0"
ok "G02 abort left service_role unchanged" "$(TP service_role)" "DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-11_agenda_create_requests_grants_fix.sql" >/dev/null && echo "PASS: G03 grants fix applies in one transaction"
ok "G03 service_role exactly SELECT,INSERT,DELETE" "$(TP service_role)" "DELETE,INSERT,SELECT"
ok "G03 sandbox_exec untouched" "$(TP sandbox_exec)" "INSERT,SELECT"
ok "G03 anon none" "$(TP anon)" ""
ok "G03 authenticated none" "$(TP authenticated)" ""
ok "G03 functions (source + ACL) still unchanged" "$(Q "$SNAP")" "$F0"
ok "G03 wrapper EXECUTE service_role only" "$(Q "select has_function_privilege('service_role','public.create_appointment_atomic_as(uuid,uuid,boolean,uuid,uuid,text,text,uuid[],text,uuid,int,jsonb)','EXECUTE')::text||has_function_privilege('authenticated','public.create_appointment_atomic_as(uuid,uuid,boolean,uuid,uuid,text,text,uuid[],text,uuid,int,jsonb)','EXECUTE')::text||has_function_privilege('anon','public.create_appointment_atomic_as(uuid,uuid,boolean,uuid,uuid,text,text,uuid[],text,uuid,int,jsonb)','EXECUTE')::text")" "truefalsefalse"
ok "G04 service_role cannot UPDATE request rows directly" "$(AS $P -d gs_move -c "set role service_role; update public.agenda_create_requests set send_confirmation=true" 2>&1 | grep -c 'permission denied')" "1"
# existing suites with the flag on (as in step 3 activation), proving public booking + RPCs unchanged
Q "update tenant_feature_flags set atomic_agenda_enabled=true" >/dev/null
for F in tests.sql tests-phase2.sql tests-phase3.sql tests-phase4.sql tests-3a.sql; do
  AS bash -c "$P -d gs_move -v ON_ERROR_STOP=1 -f $BASE/$F 2>&1" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //'
done
# ---- races: s1 holds its transaction 2 s, s2 starts 0.5 s later ----
call() { # tag actor reqid date time
  echo "BEGIN; SET LOCAL ROLE service_role; SELECT '$1:'||(r->>'code')||':'||coalesce(r->>'replay','')||':'||coalesce(r->>'appointment_id','') FROM (SELECT public.create_appointment_atomic_as('$2','$3',false,NULL,'a0000000-0000-0000-0000-000000000060','$4','$5',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'',NULL,NULL,NULL) r) x; SELECT pg_sleep(2); COMMIT;"; }
race() { echo "$2" > "$BASE/s1.sql"; echo "$3" > "$BASE/s2.sql"; chown $RUNUID "$BASE"/s?.sql
  AS bash -c "$P -d gs_move -f $BASE/s1.sql > $BASE/s1.out 2>&1 & sleep 0.5; $P -d gs_move -f $BASE/s2.sql > $BASE/s2.out 2>&1; wait"
  grep -h '^s[12]:' "$BASE/s1.out" "$BASE/s2.out" | tr '\n' ' '; }
R=$(race x "$(call s1 11111111-1111-1111-1111-111111111111 60000000-0000-4000-8000-000000000001 2026-11-09 10:00)" "$(call s2 11111111-1111-1111-1111-111111111111 60000000-0000-4000-8000-000000000001 2026-11-09 10:00)")
A1=$(echo "$R" | sed -n 's/.*s1:created:false:\([0-9a-f-]*\).*/\1/p'); A2=$(echo "$R" | sed -n 's/.*s2:created:true:\([0-9a-f-]*\).*/\1/p')
ok "X01 double click, same id, concurrent: second waits and replays the same appointment" "$([ -n "$A1" ] && [ "$A1" = "$A2" ] && echo yes)" "yes"
ok "X01 exactly one appointment" "$(Q "select count(*) from appointments where appointment_date='2026-11-09 09:00Z'")" "1"
R=$(race x "$(call s1 11111111-1111-1111-1111-111111111111 60000000-0000-4000-8000-000000000002 2026-11-10 10:00)" "$(call s2 55555555-5555-5555-5555-555555555555 60000000-0000-4000-8000-000000000003 2026-11-10 10:30)")
ok "X02 two different requests, overlapping slot: one created, one conflict" "$(echo "$R" | grep -o 's1:created' )/$(echo "$R" | grep -o 's2:conflict')" "s1:created/s2:conflict"
ok "X02 exactly one appointment" "$(Q "select count(*) from appointments where appointment_date::date='2026-11-10'")" "1"
# X03 first request rolls back while the second waits: second creates (no stuck registration)
S1="BEGIN; SET LOCAL ROLE service_role; SELECT public.create_appointment_atomic_as('11111111-1111-1111-1111-111111111111','60000000-0000-4000-8000-000000000004',false,NULL,'a0000000-0000-0000-0000-000000000060','2026-11-11','10:00',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'',NULL,NULL,NULL); SELECT pg_sleep(2); ROLLBACK;"
R=$(race x "$S1" "$(call s2 11111111-1111-1111-1111-111111111111 60000000-0000-4000-8000-000000000004 2026-11-11 10:00)")
ok "X03 first rolled back (connection lost before commit): retry creates normally" "$(echo "$R" | grep -o 's2:created:false')" "s2:created:false"
ok "X03 exactly one appointment and one request row" "$(Q "select count(*) from appointments where appointment_date::date='2026-11-11'")/$(Q "select count(*) from agenda_create_requests where request_id='60000000-0000-4000-8000-000000000004'")" "1/1"
ok "X04 no request row without an appointment" "$(Q "select count(*) from agenda_create_requests q where not exists (select 1 from appointments a where a.id=q.appointment_id)")" "0"
