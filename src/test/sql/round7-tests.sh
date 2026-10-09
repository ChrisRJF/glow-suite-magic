#!/usr/bin/env bash
# Round 7 SQL integration tests. Runs ONLY inside run-local-pg.sh (local throwaway cluster).
set -uo pipefail
DB="$PSQLX -d gs_round7_test -At"
PASS=0; FAIL=0
q()  { $DB -c "set role service_role; $1" 2>&1 | tail -n1; }
qs() { $DB -c "$1" 2>&1 | tail -n1; }   # as test superuser (setup/inspection only)
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 | expected [$3] got [$2]"; fi; }
has() { if printf '%s' "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); echo "PASS $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 | expected to contain [$3] got [$2]"; fi; }
K() { printf '%064d' "$1"; }                       # fictitious idempotency key / hash
H() { printf '%064x' "$1"; }
REF_A="c1.1.$(printf 'a%.0s' {1..64})"
REF_B="c1.1.$(printf 'b%.0s' {1..64})"
SA=11111111-1111-1111-1111-111111111111; SB=22222222-2222-2222-2222-222222222222
cmd() { # key tenant action hash contact outbound status
  q "select (r->>'result')||':'||(r->>'code')||coalesce(':'||(r->>'reason'),'') from public.gateway_process_command('$1','$2','$3','$4',${5:-null},${6:-null},${7:-null}) r;"
}
$DB -f "$BASE/round7-tests.sql" >/dev/null

echo "-- 4. transactions / idempotency"
ok "STOP applied once"              "$(cmd $(K 1) tenant-test-a opt_out_signal $(H 1) "'$REF_A'")" "applied:200"
ok "STOP stored exactly once"       "$(qs "select count(*) from whatsapp_opt_outs where contact_ref='$REF_A'")" "1"
ok "same key+hash -> duplicate"     "$(cmd $(K 1) tenant-test-a opt_out_signal $(H 1) "'$REF_A'")" "duplicate:200"
ok "still one effect"               "$(qs "select count(*) from whatsapp_opt_outs")" "1"
ok "same key, other content -> 409" "$(cmd $(K 1) tenant-test-a opt_out_signal $(H 2) "'$REF_A'")" "conflict:409"
ok "same key, other tenant -> 409"  "$(cmd $(K 1) tenant-test-b opt_out_signal $(H 1) "'$REF_A'")" "conflict:409"
ok "no STOP leaked to salon B"      "$(qs "select count(*) from whatsapp_opt_outs where salon_id='$SB'")" "0"
ok "same STOP new key -> noop 202"  "$(cmd $(K 2) tenant-test-a opt_out_signal $(H 3) "'$REF_A'")" "accepted_noop:202"

# Concurrency: two real, separate connections. Session 1 holds its transaction open.
$DB -c "set role service_role; begin; select public.gateway_process_command('$(K 10)','tenant-test-a','opt_out_signal','$(H 10)','$REF_B'); select pg_sleep(2); commit;" > /tmp/r7_s1 2>&1 &
P1=$!; sleep 0.5
$DB -c "set role service_role; select (r->>'result') from public.gateway_process_command('$(K 10)','tenant-test-a','opt_out_signal','$(H 10)','$REF_B') r;" > /tmp/r7_s2 2>&1 &
P2=$!; sleep 0.5
ok "session 2 blocked on session 1 lock" "$(qs "select count(*) from pg_stat_activity where wait_event_type='Lock' and datname='gs_round7_test'")" "1"
wait $P1 $P2
has "concurrent: session 1 applied"   "$(cat /tmp/r7_s1)" '"applied"'
ok  "concurrent: session 2 duplicate" "$(tail -n1 /tmp/r7_s2)" "duplicate"
ok  "concurrent: one effect"          "$(qs "select count(*) from whatsapp_opt_outs where contact_ref='$REF_B'")" "1"
ok  "concurrent: one receipt"         "$(qs "select count(*) from gateway_command_receipts where idempotency_key='$(K 10)'")" "1"

# Concurrent, same key different content -> second sees 409
$DB -c "set role service_role; begin; select public.gateway_process_command('$(K 11)','tenant-test-a','inbound_message_record','$(H 11)'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
P1=$!; sleep 0.4
R=$($DB -c "set role service_role; select (r->>'result') from public.gateway_process_command('$(K 11)','tenant-test-a','inbound_message_record','$(H 12)') r;" | tail -n1)
wait $P1
ok "concurrent diff content -> conflict" "$R" "conflict"

# Rollback: business error after the call -> receipt and effect both gone.
REF_C="c1.1.$(printf 'c%.0s' {1..64})"
$DB -c "set role service_role; begin; select public.gateway_process_command('$(K 20)','tenant-test-a','opt_out_signal','$(H 20)','$REF_C'); select 1/0; commit;" >/dev/null 2>&1
ok "rollback: no receipt" "$(qs "select count(*) from gateway_command_receipts where idempotency_key='$(K 20)'")" "0"
ok "rollback: no effect"  "$(qs "select count(*) from whatsapp_opt_outs where contact_ref='$REF_C'")" "0"
# In-function DB error (invalid contact_ref violates CHECK) -> whole call rolled back
R=$(cmd $(K 21) tenant-test-a opt_out_signal $(H 21) "'not-a-ref'")
has "invalid contact_ref -> error raised" "$R" "violates check constraint"
ok  "invalid contact_ref: no receipt" "$(qs "select count(*) from gateway_command_receipts where idempotency_key='$(K 21)'")" "0"
R=$(cmd $(K 22) tenant-test-a opt_out_signal $(H 22))
has "null contact_ref -> error raised" "$R" "null value"
ok  "null contact_ref: no receipt" "$(qs "select count(*) from gateway_command_receipts where idempotency_key='$(K 22)'")" "0"
# Killed mid-transaction
$DB -c "set application_name='r7victim'; set role service_role; begin; select public.gateway_process_command('$(K 23)','tenant-test-a','opt_out_signal','$(H 23)','$REF_C'); select pg_sleep(10); commit;" >/dev/null 2>&1 &
P1=$!; sleep 0.7
qs "select pg_terminate_backend(pid) from pg_stat_activity where application_name='r7victim'" >/dev/null; wait $P1
ok "killed tx: no receipt" "$(qs "select count(*) from gateway_command_receipts where idempotency_key='$(K 23)'")" "0"
ok "killed tx: no effect"  "$(qs "select count(*) from whatsapp_opt_outs where contact_ref='$REF_C'")" "0"
ok "retry after rollback applies" "$(cmd $(K 23) tenant-test-a opt_out_signal $(H 23) "'$REF_C'")" "applied:200"
ok "retry: exactly one effect"    "$(qs "select count(*) from whatsapp_opt_outs where contact_ref='$REF_C'")" "1"

echo "-- 5. tenant isolation / access"
ok "unknown tenant -> 403"   "$(cmd $(K 30) tenant-nope opt_out_signal $(H 30) "'$REF_A'")" "tenant_not_authorized:403"
ok "disabled tenant -> 403"  "$(cmd $(K 31) tenant-test-off opt_out_signal $(H 31) "'$REF_A'")" "tenant_not_authorized:403"
ok "disallowed action -> 403" "$(cmd $(K 32) tenant-test-b inbound_message_record $(H 32))" "tenant_not_authorized:403"
ok "unknown action -> 403"   "$(cmd $(K 33) tenant-test-a drop_everything $(H 33))" "tenant_not_authorized:403"
ok "confirmation -> 422"     "$(cmd $(K 34) tenant-test-a confirmation_token_received $(H 34))" "business_rejected:422:confirmation_not_enabled"
ok "no receipts for rejected" "$(qs "select count(*) from gateway_command_receipts where idempotency_key in ('$(K 30)','$(K 31)','$(K 32)','$(K 33)','$(K 34)')")" "0"
R=$(cmd BAD tenant-test-a inbound_message_record $(H 35)); has "malformed idempotency key refused" "$R" "check constraint"
R=$(cmd $(K 36) tenant-test-a inbound_message_record XYZ); has "malformed request hash refused" "$R" "check constraint"
for role in anon authenticated test_intruder; do
  has "$role cannot execute process_command" "$($DB -c "set role $role; select public.gateway_process_command('$(K 40)','tenant-test-a','opt_out_signal','$(H 40)','$REF_A');" 2>&1)" "permission denied"
  has "$role cannot execute is_opted_out" "$($DB -c "set role $role; select public.whatsapp_is_opted_out('$SA', array['$REF_A']);" 2>&1)" "permission denied"
  has "$role cannot execute retention" "$($DB -c "set role $role; select public.gateway_receipts_retention(400);" 2>&1)" "permission denied"
  has "$role cannot read receipts" "$($DB -c "set role $role; select count(*) from gateway_command_receipts;" 2>&1)" "permission denied"
  has "$role cannot read opt-outs" "$($DB -c "set role $role; select count(*) from whatsapp_opt_outs;" 2>&1)" "permission denied"
  has "$role cannot write opt-outs" "$($DB -c "set role $role; insert into whatsapp_opt_outs values ('$SA','$REF_A');" 2>&1)" "permission denied"
done
has "anon cannot read tenant links" "$($DB -c "set role anon; select count(*) from gateway_tenant_links;" 2>&1)" "permission denied"
ok "authenticated as salon A sees only own link" "$($DB -c "set request.jwt.claim.sub='$SA'; set role authenticated; select string_agg(tenant_id,',') from gateway_tenant_links;" | tail -n1)" "tenant-test-a"
ok "authenticated without uid sees nothing" "$($DB -c "set role authenticated; select count(*) from gateway_tenant_links;" | tail -n1)" "0"
has "authenticated cannot update own link" "$($DB -c "set request.jwt.claim.sub='$SA'; set role authenticated; update gateway_tenant_links set enabled=false;" 2>&1)" "permission denied"
ok "security definer functions pin search_path" "$(qs "select count(*) from pg_proc where proname in ('gateway_process_command','whatsapp_is_opted_out','gateway_receipts_retention') and prosecdef and proconfig::text like '%search_path=public%'")" "3"
ok "is_opted_out scoped per salon (A yes)" "$(q "select public.whatsapp_is_opted_out('$SA', array['$REF_A'])")" "t"
ok "is_opted_out scoped per salon (B no)"  "$(q "select public.whatsapp_is_opted_out('$SB', array['$REF_A'])")" "f"

echo "-- 6. delivery statuses"
qs "insert into whatsapp_outbound_messages(salon_id,outbound_ref,status) values ('$SA','out-a-1','sent'),('$SA','out-a-2','sent'),('$SA','out-a-3','sent'),('$SB','out-b-1','sent')" >/dev/null
st() { qs "select status||':'||failed_attempts||':'||status_conflict from whatsapp_outbound_messages where salon_id='$1' and outbound_ref='$2'"; }
n=100; d() { n=$((n+1)); cmd $(K $n) "$1" delivery_status_record $(H $n) null "'$2'" "'$3'"; }
ok "sent->delivered" "$(d tenant-test-a out-a-1 delivered)" "applied:200"
ok "delivered->read" "$(d tenant-test-a out-a-1 read)" "applied:200"
ok "late delivered after read -> noop" "$(d tenant-test-a out-a-1 delivered)" "accepted_noop:202"
ok "late sent after read -> noop" "$(d tenant-test-a out-a-1 sent)" "accepted_noop:202"
ok "failed after read -> applied (flag only)" "$(d tenant-test-a out-a-1 failed)" "applied:200"
ok "  state after failed-after-read" "$(st $SA out-a-1)" "read:1:t"
d tenant-test-a out-a-2 delivered >/dev/null
d tenant-test-a out-a-2 failed >/dev/null
ok "failed after delivered keeps delivered" "$(st $SA out-a-2)" "delivered:1:t"
d tenant-test-a out-a-3 failed >/dev/null
ok "sent->failed" "$(st $SA out-a-3)" "failed:1:f"
ok "duplicate failed -> noop" "$(d tenant-test-a out-a-3 failed)" "accepted_noop:202"
ok "delivered after failed -> applied" "$(d tenant-test-a out-a-3 delivered)" "applied:200"
ok "  state: delivered, history kept" "$(st $SA out-a-3)" "delivered:1:f"
N=$((n+1)); cmd $(K $N) tenant-test-a delivery_status_record $(H $N) null "'out-a-2'" "'read'" >/dev/null
ok "duplicate callback (same key) -> duplicate" "$(cmd $(K $N) tenant-test-a delivery_status_record $(H $N) null "'out-a-2'" "'read'")" "duplicate:200"
n=$((N+1))
ok "unknown outbound ref -> 422" "$(d tenant-test-a out-nope delivered)" "business_rejected:422:unknown_outbound_ref"
ok "other salon's message -> 422" "$(d tenant-test-a out-b-1 delivered)" "business_rejected:422:unknown_outbound_ref"
ok "  salon B message untouched" "$(st $SB out-b-1)" "sent:0:f"
ok "bogus status -> noop, unchanged" "$(d tenant-test-a out-a-2 exploded; st $SA out-a-2 | tail -n1)" "read:1:t"

echo "-- 7. retention"
qs "insert into gateway_command_receipts(idempotency_key,tenant_id,salon_id,action_type,request_hash,status,response_code,created_at) values
 ('$(K 900)','tenant-test-a','$SA','opt_out_signal','$(H 900)','applied',200, now()-interval '399 days'),
 ('$(K 901)','tenant-test-a','$SA','opt_out_signal','$(H 901)','applied',200, now()-interval '401 days')" >/dev/null
OPT_BEFORE=$(qs "select count(*) from whatsapp_opt_outs"); OUT_BEFORE=$(qs "select md5(string_agg(t::text,'' order by outbound_ref)) from whatsapp_outbound_messages t")
has "retention < 400 refused" "$(q "select public.gateway_receipts_retention(399)")" "retention must be >= 400 days"
ok "retention 400 deletes only the 401-day record" "$(q "select public.gateway_receipts_retention(400)")" "1"
ok "399-day receipt kept" "$(qs "select count(*) from gateway_command_receipts where idempotency_key='$(K 900)'")" "1"
ok "duplicate within retention still recognised" "$(cmd $(K 900) tenant-test-a opt_out_signal $(H 900) "'$REF_A'")" "duplicate:200"
ok "opt-outs untouched by cleanup" "$(qs "select count(*) from whatsapp_opt_outs")" "$OPT_BEFORE"
ok "outbound untouched by cleanup" "$(qs "select md5(string_agg(t::text,'' order by outbound_ref)) from whatsapp_outbound_messages t")" "$OUT_BEFORE"
ok "unrelated table untouched" "$(qs "select count(*) from unrelated_sentinel")" "1"
has "retention null refused or noop" "$(q "select coalesce(public.gateway_receipts_retention(null)::text,'null')")" "null"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
