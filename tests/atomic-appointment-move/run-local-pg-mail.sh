#!/usr/bin/env bash
# Step 3A: throwaway local PostgreSQL (private socket, deleted afterwards), fictional data only.
# Applies the live step-1 SQL + activation grants, then the PROPOSED 3A migration, runs existing suites,
# the 3A suite and real two-session races. Never touches the project database.
set -euo pipefail
LOG=$(mktemp /tmp/atomic-mail-log.XXXXXX); exec > >(tee "$LOG") 2>&1
finish() { local rc=$?; AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"
  local np nf; np=$(grep -c '^PASS' "$LOG" || true); nf=$(grep -cE '^FAIL|ERROR' "$LOG" || true)
  echo "SUMMARY: pass=$np fail=$nf"; rm -f "$LOG"; if [ "$rc" -ne 0 ] || [ "$nf" -ne 0 ] || [ "$np" -eq 0 ]; then exit 1; fi; exit 0; }
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; PM="$ROOT/docs/proposed-migrations"
BASE=/tmp/glowsuite-pg-mail; RUNUID=$(id -u lovable 2>/dev/null || echo 4711)
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
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-11_agenda_create_route.sql -f $BASE/2026-10-11_agenda_create_requests_grants_fix.sql" >/dev/null
cp "$PM/2026-10-11_manual_confirmation_outbox.sql" "$BASE/"; chown $RUNUID "$BASE"/*.sql
F0=$(Q "select md5(string_agg(p.oid::regprocedure::text||md5(p.prosrc),'|' order by 1)) from pg_proc p where pronamespace='public'::regnamespace")
python3 - "$BASE/2026-10-11_manual_confirmation_outbox.sql" "$BASE/badmail.sql" <<'PY'
import sys; s=open(sys.argv[1]).read(); k=s.index('-- final verification')
open(sys.argv[2],'w').write(s[:k]+"GRANT SELECT ON public.manual_confirmation_outbox TO authenticated;\n"+s[k:])
PY
chown $RUNUID "$BASE/badmail.sql"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/badmail.sql" >/dev/null 2>&1 && echo "FAIL: O01 stray grant passed" || echo "PASS: O01 stray grant aborts migration"
ok "O01 nothing left after abort" "$(Q "select count(*) from pg_class where relname='manual_confirmation_outbox'")" "0"
AS bash -c "$P -d gs_move -1 -v ON_ERROR_STOP=1 -f $BASE/2026-10-11_manual_confirmation_outbox.sql" >/dev/null && echo "PASS: O02 outbox migration applies in one transaction"
ok "O03 existing functions unchanged" "$(Q "select md5(string_agg(p.oid::regprocedure::text||md5(p.prosrc),'|' order by 1)) from pg_proc p where pronamespace='public'::regnamespace and proname not in ('enqueue_manual_confirmation','claim_manual_confirmations','finish_manual_confirmation')")" "$F0"
Q "update tenant_feature_flags set atomic_agenda_enabled=true where tenant_id='11111111-1111-1111-1111-111111111111'" >/dev/null
C() { Q "SET ROLE service_role; SELECT (r->>'code')||':'||coalesce(r->>'replay','') FROM (SELECT public.create_appointment_atomic_as('11111111-1111-1111-1111-111111111111','$1',$2,NULL,'a0000000-0000-0000-0000-000000000060','$3','$4',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'',NULL,NULL,NULL) r) x" | tail -1; }
ok "O04 create with mail: created" "$(C 70000000-0000-4000-8000-000000000001 true 2026-11-20 10:00)" "created:false"
ok "O04 one outbox row in the same transaction" "$(Q "select count(*)||status from manual_confirmation_outbox o join agenda_create_requests q on q.appointment_id=o.appointment_id where q.request_id='70000000-0000-4000-8000-000000000001' group by status")" "1pending"
ok "O05 replay same request: same result, still one outbox row" "$(C 70000000-0000-4000-8000-000000000001 true 2026-11-20 10:00)/$(Q "select count(*) from manual_confirmation_outbox")" "created:true/1"
ok "O06 same id, other choice: mismatch, nothing added" "$(C 70000000-0000-4000-8000-000000000001 false 2026-11-20 10:00)/$(Q "select count(*) from manual_confirmation_outbox")" "request_mismatch:/1"
ok "O07 create without mail: no outbox row" "$(C 70000000-0000-4000-8000-000000000002 false 2026-11-20 14:00)/$(Q "select count(*) from manual_confirmation_outbox")" "created:false/1"
ok "O08 refused create (conflict): no appointment, no outbox row" "$(C 70000000-0000-4000-8000-000000000003 true 2026-11-20 10:00)/$(Q "select count(*) from manual_confirmation_outbox")" "conflict:/1"
ok "O09 rolled back create leaves no outbox row" "$(Q "BEGIN; SET LOCAL ROLE service_role; SELECT public.create_appointment_atomic_as('11111111-1111-1111-1111-111111111111','70000000-0000-4000-8000-000000000004',true,NULL,'a0000000-0000-0000-0000-000000000060','2026-11-21','10:00',ARRAY['e0000000-0000-0000-0000-00000000000a']::uuid[],'',NULL,NULL,NULL); ROLLBACK;" >/dev/null; Q "select count(*) from manual_confirmation_outbox")" "1"
CL() { Q "SET ROLE service_role; SELECT count(*) FROM public.claim_manual_confirmations(10,60)" | tail -1; }
ok "O10 claim takes the row once" "$(CL)/$(CL)" "1/0"
AID=$(Q "select appointment_id from manual_confirmation_outbox")
ok "O11 stale attempt cannot finish" "$(Q "SET ROLE service_role; SELECT public.finish_manual_confirmation('$AID',9,'sent','x')" | tail -1)" "f"
ok "O12 retry returns to pending, expired lease reclaimable" "$(Q "SET ROLE service_role; SELECT public.finish_manual_confirmation('$AID',1,'retry','send_failed')" | tail -1)/$(CL)" "t/1"
Q "update manual_confirmation_outbox set lease_until=now()-interval '1 s'" >/dev/null
ok "O13 crashed worker: expired lease reclaimed with next attempt" "$(CL)/$(Q "select attempts from manual_confirmation_outbox")" "1/3"
ok "O14 sent is final" "$(Q "SET ROLE service_role; SELECT public.finish_manual_confirmation('$AID',3,'sent','sent')" | tail -1)/$(CL)/$(Q "select status from manual_confirmation_outbox")" "t/0/sent"
for R in anon authenticated; do
  ok "O15 $R cannot read outbox or call worker functions" "$(Q "select has_table_privilege('$R','public.manual_confirmation_outbox','SELECT')::text||has_function_privilege('$R','public.claim_manual_confirmations(integer,integer)','EXECUTE')::text||has_function_privilege('$R','public.finish_manual_confirmation(uuid,integer,text,text)','EXECUTE')::text")" "falsefalsefalse"
done
ok "O16 service_role: only SELECT on the table" "$(Q "select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('service_role','public.manual_confirmation_outbox',p)")" "SELECT"
