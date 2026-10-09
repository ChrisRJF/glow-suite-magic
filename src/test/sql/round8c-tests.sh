#!/usr/bin/env bash
# Round 8C SQL tests. Runs ONLY inside run-local-pg-8c.sh (local throwaway cluster). Fictitious data.
set -uo pipefail
DB="$PSQLX -d gs_round8c_test -At"
PASS=0; FAIL=0
q()  { $DB -c "set role service_role; $1" 2>&1 | tail -n1; }
qr() { $DB -c "set role $1; $2" 2>&1 | tail -n1; }
qs() { $DB -c "$1" 2>&1 | tail -n1; }
qa() { $DB -c "set role service_role; $1" 2>&1; }
qsa() { $DB -c "$1" 2>&1; }
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 | expected [$3] got [$2]"; fi; }
has() { if printf '%s' "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); echo "PASS $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 | expected [$3] in [$2]"; fi; }
H() { printf '%064x' "$1"; }
SA=11111111-1111-1111-1111-111111111111; SB=22222222-2222-2222-2222-222222222222; C=c0000000-0000-0000-0000-0000000000a1
claim() { q "select (r->>'result')||coalesce(':'||(r->>'state'),'') from public.wa_claim_send('$1','$2','$3','$C','${4:-reminder}') r;"; }
fin() { q "select public.wa_finalize_send('$1','$2','$3',${4:-null},null);"; }
NX() { printf '%032x' "$1"; }

echo "-- claims"
ok "first claim created"               "$(claim $SA $(H 1) $(H 100))" "created"
ok "same key+fp -> exists:claimed"     "$(claim $SA $(H 1) $(H 100))" "exists:claimed"
ok "same key other fp -> conflict"     "$(claim $SA $(H 1) $(H 101))" "conflict"
ok "same key other tenant independent" "$(claim $SB $(H 1) $(H 100))" "created"
ok "invalid key -> invalid (no write)" "$(claim $SA nothex $(H 100))" "invalid"
ok "invalid kind -> invalid"           "$(claim $SA $(H 2) $(H 100) 'Bad Kind')" "invalid"
ok "invalid rows never stored"         "$(qs "select count(*) from wa_send_claims")" "2"
ok "conflict response leaks no fp"     "$(q "select r ? 'fingerprint' from public.wa_claim_send('$SA','$(H 1)','$(H 101)','$C','reminder') r;")" "f"

echo "-- finalize / states"
ok "claimed -> sent"                   "$(fin $SA $(H 1) sent "'+31****78'")" "t"
ok "sent is terminal"                  "$(fin $SA $(H 1) failed)" "f"
ok "retry after sent -> exists:sent"   "$(claim $SA $(H 1) $(H 100))" "exists:sent"
ok "bad state refused"                 "$(fin $SB $(H 1) claimed)" "f"
ok "full phone refused as mask"        "$(fin $SB $(H 1) sent "'+31612345678'")" "f"
ok "unknown is terminal"               "$(fin $SB $(H 1) unknown >/dev/null; fin $SB $(H 1) sent)" "f"
ok "check constraint blocks raw phone" "$(qsa "update wa_send_claims set to_masked='+31612345678' where tenant_id='$SB'" | grep -c violates)" "1"

echo "-- concurrency: two real connections, same key"
$DB -c "set role service_role; begin; select public.wa_claim_send('$SA','$(H 10)','$(H 110)','$C','reminder'); select pg_sleep(2); commit;" > /tmp/r8c_s1 2>&1 &
P1=$!; sleep 0.5
$DB -c "set role service_role; select (r->>'result')||coalesce(':'||(r->>'state'),'') from public.wa_claim_send('$SA','$(H 10)','$(H 110)','$C','reminder') r;" > /tmp/r8c_s2 2>&1 &
P2=$!; sleep 0.5
ok "session 2 waits on session 1"      "$(qs "select count(*) from pg_stat_activity where wait_event_type='Lock' and datname='gs_round8c_test'")" "1"
wait $P1 $P2
has "session 1 created"                "$(cat /tmp/r8c_s1)" '"created"'
ok  "session 2 sees exists"            "$(tail -n1 /tmp/r8c_s2)" "exists:claimed"
ok  "exactly one row"                  "$(qs "select count(*) from wa_send_claims where claim_key='$(H 10)'")" "1"

$DB -c "set role service_role; begin; select public.wa_claim_send('$SA','$(H 11)','$(H 111)','$C','reminder'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
P1=$!; sleep 0.4
R=$(q "select r->>'result' from public.wa_claim_send('$SA','$(H 11)','$(H 112)','$C','reminder') r;"); wait $P1
ok "concurrent other fp -> conflict"   "$R" "conflict"

echo "-- rollback"
$DB -c "set role service_role; begin; select public.wa_claim_send('$SA','$(H 12)','$(H 120)','$C','reminder'); select pg_sleep(1.5); rollback;" >/dev/null 2>&1 &
P1=$!; sleep 0.4
R=$(q "select r->>'result' from public.wa_claim_send('$SA','$(H 12)','$(H 121)','$C','reminder') r;"); wait $P1
ok "after rollback the waiter claims"  "$R" "created"
ok "rolled-back fp not stored"         "$(qs "select fingerprint='$(H 121)' from wa_send_claims where claim_key='$(H 12)'")" "t"
$DB -c "set role service_role; begin; select public.wa_claim_send('$SA','$(H 13)','$(H 130)','$C','reminder'); select 1/0; commit;" >/dev/null 2>&1
ok "crash mid-transaction leaves nothing" "$(qs "select count(*) from wa_send_claims where claim_key='$(H 13)'")" "0"

echo "-- nonces"
ok "nonce first use"                   "$(q "select public.wa_remember_nonce('reminder-scheduler','$(NX 1)', now()+interval '10 minutes');")" "t"
ok "nonce replay"                      "$(q "select public.wa_remember_nonce('reminder-scheduler','$(NX 1)', now()+interval '10 minutes');")" "f"
ok "same nonce other caller independent" "$(q "select public.wa_remember_nonce('auto-rebook','$(NX 1)', now()+interval '10 minutes');")" "t"
has "unknown caller rejected"          "$(qa "select public.wa_remember_nonce('evil','$(NX 2)', now()+interval '10 minutes');")" "violates check"
has "bad nonce rejected"               "$(qa "select public.wa_remember_nonce('auto-rebook','XYZ', now()+interval '10 minutes');")" "violates check"
has "expiry too far rejected"          "$(qa "select public.wa_remember_nonce('auto-rebook','$(NX 3)', now()+interval '2 days');")" "invalid_nonce_expiry"
has "expiry in past rejected"          "$(qa "select public.wa_remember_nonce('auto-rebook','$(NX 3)', now()-interval '1 minute');")" "invalid_nonce_expiry"
$DB -c "set role service_role; begin; select public.wa_remember_nonce('customer-forms','$(NX 9)', now()+interval '10 minutes'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
P1=$!; sleep 0.4
R=$(q "select public.wa_remember_nonce('customer-forms','$(NX 9)', now()+interval '10 minutes');"); wait $P1
ok "concurrent nonce -> second is replay" "$R" "f"

echo "-- rights / RLS"
for role in anon authenticated; do
  has "$role cannot read claims"       "$(qr $role "select count(*) from public.wa_send_claims;")" "permission denied"
  has "$role cannot read nonces"       "$(qr $role "select count(*) from public.wa_service_nonces;")" "permission denied"
  has "$role cannot claim"             "$(qr $role "select public.wa_claim_send('$SA','$(H 50)','$(H 50)','$C','reminder');")" "permission denied"
  has "$role cannot remember nonce"    "$(qr $role "select public.wa_remember_nonce('auto-rebook','$(NX 50)', now()+interval '5 minutes');")" "permission denied"
  has "$role cannot purge"             "$(qr $role "select public.wa_send_purge(400);")" "permission denied"
done
ok "RLS forced on both tables"         "$(qs "select count(*) from pg_class where relname in ('wa_send_claims','wa_service_nonces') and relrowsecurity and relforcerowsecurity")" "2"
ok "functions pin search_path"         "$(qs "select count(*) from pg_proc where proname like 'wa\_%' and proconfig::text like '%search_path=pg_catalog, public, pg_temp%'")" "4"
ok "no message/phone/secret columns"   "$(qs "select count(*) from information_schema.columns where table_name in ('wa_send_claims','wa_service_nonces') and column_name ~ '(message|body|phone|to_number|secret|token|link)'")" "0"

echo "-- temp-table shadowing"
R=$($DB -c "create temp table wa_send_claims(tenant_id uuid, claim_key text, fingerprint text, state text, customer_id uuid, kind text, to_masked text, provider_code int, created_at timestamptz, updated_at timestamptz, primary key(tenant_id, claim_key)); set role service_role; select r->>'result' from public.wa_claim_send('$SA','$(H 60)','$(H 160)','$C','reminder') r;" | tail -n1)
ok "temp table cannot shadow"          "$R" "created"
ok "row landed in public table"        "$(qs "select count(*) from public.wa_send_claims where claim_key='$(H 60)'")" "1"

echo "-- retention"
qs "insert into wa_send_claims(tenant_id,claim_key,fingerprint,state,customer_id,kind,created_at) values
 ('$SA','$(H 70)','$(H 70)','sent','$C','reminder',now()-interval '401 days'),
 ('$SA','$(H 71)','$(H 71)','unknown','$C','reminder',now()-interval '401 days'),
 ('$SA','$(H 72)','$(H 72)','unknown','$C','reminder',now()-interval '431 days'),
 ('$SA','$(H 73)','$(H 73)','sent','$C','reminder',now()-interval '10 days')" >/dev/null
qs "insert into wa_service_nonces values ('auto-rebook','$(NX 80)', now()-interval '1 second')" >/dev/null
has "retention below 30 refused"       "$(qa "select public.wa_send_purge(7);")" "retention_too_short"
has "retention null refused"           "$(qa "select public.wa_send_purge(null);")" "retention_too_short"
ok "purge counts"                      "$(q "select public.wa_send_purge(400)::text;")" '{"claims": 2, "nonces": 1}'
ok "old unknown kept for review"       "$(qs "select count(*) from wa_send_claims where claim_key='$(H 71)'")" "1"
ok "recent sent kept"                  "$(qs "select count(*) from wa_send_claims where claim_key='$(H 73)'")" "1"
ok "live nonces kept"                  "$(qs "select count(*) from wa_service_nonces where expires_at > now()")" "3"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
