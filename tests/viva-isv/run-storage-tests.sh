#!/usr/bin/env bash
set -euo pipefail
ROOT="$(pwd)"; BASE=/tmp/gs-isv-storage; U=$(id -u lovable)
mkdir -p "$BASE/data" "$BASE/sock"; chown -R "$U:$U" "$BASE"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid="$U" --regid="$U" --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U postgres -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null; rm -rf "$BASE"' EXIT
P=(psql -X -q -At -h "$BASE/sock" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${P[@]}" -f "$ROOT/tests/viva-isv/storage-fixture.sql" >/dev/null
"${P[@]}" -c "BEGIN; SELECT test_reserve('d0000000-0000-4000-8000-000000000001','same-key'); SELECT pg_sleep(1); COMMIT;" >"$BASE/race1" & A=$!
"${P[@]}" -c "SELECT test_reserve('d0000000-0000-4000-8000-000000000002','same-key');" >"$BASE/race2" & B=$!
wait "$A"; wait "$B"
"${P[@]}" -f "$ROOT/tests/viva-isv/storage-assertions.sql"
"${P[@]}" -c "SELECT isv_payment_record('d0000000-0000-4000-8000-000000000003','refund-a','refund',1250);" >"$BASE/refund1" & A=$!
"${P[@]}" -c "SELECT isv_payment_record('d0000000-0000-4000-8000-000000000003','refund-b','refund',1250);" >"$BASE/refund2" & B=$!
wait "$A"; wait "$B"
"${P[@]}" -c "SELECT assert_test('concurrent refunds total',refunded_amount_cents::text,'2500'),assert_test('concurrent refund fee',refunded_fee_cents::text,'35') FROM isv_fee_snapshots WHERE payment_id='d0000000-0000-4000-8000-000000000003'; SELECT assert_test('duplicate full refund',isv_payment_record('d0000000-0000-4000-8000-000000000003','refund-a','refund',1250),'duplicate'); SELECT assert_test('refund above total',isv_payment_record('d0000000-0000-4000-8000-000000000003','refund-c','refund',1),'error');"
