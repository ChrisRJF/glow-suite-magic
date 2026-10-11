#!/usr/bin/env bash
# Offline test of 01b_dry_run_readonly_inline.sql on a throwaway PostgreSQL (no TCP). Fictional salons only.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
D="$ROOT/docs/prepared-patches/atomic-appointment-move/public-slug"
BASE=/tmp/glowsuite-pg-slug-b; RUNUID=$(id -u lovable 2>/dev/null || echo 4711); PASS=0; FAIL=0
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; cp "$D"/*.sql "$BASE/"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U t -A trust -E UTF8 --locale=C >/dev/null 2>&1 || exit 1
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null || exit 1
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1; rm -rf "$BASE"; echo "SUMMARY: pass=$PASS fail=$FAIL"; { [ $FAIL -eq 0 ] && [ $PASS -gt 0 ]; } || exit 1' EXIT
Q() { AS psql -X -q -At -h "$BASE/sock" -U t -d postgres -v ON_ERROR_STOP=1 "$@" 2>&1; }
ok() { if [ "$2" = "$3" ]; then echo "PASS $1"; PASS=$((PASS+1)); else echo "FAIL $1: got [$2] want [$3]"; FAIL=$((FAIL+1)); fi; }
B="$BASE/01b_dry_run_readonly_inline.sql"
reset() { Q -c "drop table if exists public.settings; create table public.settings(id uuid primary key default gen_random_uuid(), user_id uuid default gen_random_uuid(), created_at timestamptz default clock_timestamp(), salon_name text, public_slug text);
  create unique index on public.settings(public_slug) where public_slug is not null;" >/dev/null; [ -n "$1" ] && Q -c "$1" >/dev/null; }
EXPR=$(grep -o "btrim(regexp_replace(lower.*'-') AS derived" "$B" | sed 's/ AS derived$//')
NAMES=("Studio Één" "Salon Bloem & Co" "  BEAUTY   lounge " "Café Noïr" "Nail-Bar_24/7" "Ångström Spa" "Œuvre Beauté" "ﬁne Hair" "Kelvin K Salon" "İstanbul Kuaför" "Salon Ø" "日本 Salon" "Hair—by Ann")
reset ""
for n in "${NAMES[@]}"; do
  js=$(bun -e 'const s=v=>v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");console.log(s(process.argv[1]))' "$n")
  inl=$(Q -c "truncate settings; insert into settings(salon_name) values (\$q\$$n\$q\$); select $EXPR from settings")
  fn=$(Q -f "$BASE/00_slug_function.sql" -c "select pg_temp.gs_slug(\$q\$$n\$q\$)")
  ok "inline = server = migration: '$js'" "$inl|$fn" "$js|$js"
done
CAT="select md5(string_agg(oid::text||relname,',' order by oid)) from pg_class"
PROC="select count(*) from pg_proc"
LIVE=11111111-0000-0000-0000-000000000001
run() { Q -v live_user=$LIVE -f "$B" | tail -1; }
live() { Q -c "update public.settings set user_id='$LIVE' where id=(select id from public.settings order by created_at limit 1)" >/dev/null; }
# happy: 9 fictional salons, all missing
reset "insert into public.settings(salon_name) select 'Fictief Salon '||chr(64+g) from generate_series(1,9) g;"; live
C0=$(Q -c "$CAT"); P0=$(Q -c "$PROC"); S0=$(Q -c "select md5(string_agg(id||coalesce(public_slug,'~'),',')) from settings"); X0=$(Q -c "select txid_current_if_assigned() is null")
ok "9/9 OK" "$(run)" "total=9 missing=9 empty_derived=0 conflict_groups=0 suffixed=0 duplicate_after=0 live_rows=1 live_plain=1 would_update=9 verdict=OK"
ok "no objects created" "$(Q -c "$CAT")|$(Q -c "$PROC")" "$C0|$P0"
ok "no data changed" "$(Q -c "select md5(string_agg(id||coalesce(public_slug,'~'),',')) from settings")" "$S0"
ok "file has no writes/DDL/volatile calls" "$(grep -viE '^\s*--' "$B" | sed 's/would_update//g' | grep -ciwE 'insert|update|delete|create|alter|drop|grant|truncate|copy|nextval|setval|set_config|pg_temp|lock|do|call|perform|function')" "0"
ok "write inside its transaction is refused" "$(sed 's/^ROLLBACK;/CREATE TEMP TABLE x(i int);\nROLLBACK;/' "$B" > "$BASE/w.sql"; chown $RUNUID "$BASE/w.sql"; Q -v live_user=$LIVE -f "$BASE/w.sql" | grep -c 'read-only transaction')" "1"
# conflicts
reset "insert into public.settings(salon_name) values ('Studio Een'),('studio één'),('Ander');"; live
ok "similar names resolved by suffix" "$(run | grep -o 'conflict_groups=.*')" "conflict_groups=1 suffixed=1 duplicate_after=0 live_rows=1 live_plain=1 would_update=3 verdict=OK"
reset "insert into public.settings(salon_name) values ('Studio Een'),('Ander');"
ok "live salon absent STOP" "$(run | grep -o 'live_rows=0.*verdict=STOP' | wc -l)" "1"
reset "insert into public.settings(salon_name,public_slug) values ('A','salon-x'),('Salon X',null);"; live
ok "collides with existing STOP" "$(run | grep -o 'duplicate_after=1.*verdict=STOP' | wc -l)" "1"
reset "insert into public.settings(salon_name) values ('Goed'),('!!!'),(null);"; live
ok "no usable name STOP" "$(run)" "total=3 missing=3 empty_derived=2 conflict_groups=0 suffixed=0 duplicate_after=0 live_rows=1 live_plain=1 would_update=1 verdict=STOP"
reset "insert into public.settings(salon_name,public_slug) values ('Studio Één',null),('Bloem',' '),('Café','eigen');"; live
ok "existing kept, mixed OK" "$(run)" "total=3 missing=2 empty_derived=0 conflict_groups=0 suffixed=0 duplicate_after=0 live_rows=1 live_plain=1 would_update=2 verdict=OK"
ok "rerun identical" "$(run)" "total=3 missing=2 empty_derived=0 conflict_groups=0 suffixed=0 duplicate_after=0 live_rows=1 live_plain=1 would_update=2 verdict=OK"
