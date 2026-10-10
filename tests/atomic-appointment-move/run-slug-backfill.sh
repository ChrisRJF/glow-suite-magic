#!/usr/bin/env bash
# Offline test of the public_slug backfill on a throwaway PostgreSQL (no TCP).
# Fictional salons only. Never touches the project database.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
D="$ROOT/docs/prepared-patches/atomic-appointment-move/public-slug"
BASE=/tmp/glowsuite-pg-slug; RUNUID=$(id -u lovable 2>/dev/null || echo 4711); PASS=0; FAIL=0
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; cp "$D"/*.sql "$BASE/"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U t -A trust -E UTF8 --locale=C >"$BASE/init.log" 2>&1 || { cat "$BASE/init.log"; exit 1; }
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null || { cat "$BASE/log"; exit 1; }
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1; rm -rf "$BASE"; echo "SUMMARY: pass=$PASS fail=$FAIL"; { [ $FAIL -eq 0 ] && [ $PASS -gt 0 ]; } || exit 1' EXIT
Q() { AS psql -X -q -At -h "$BASE/sock" -U t -d postgres -v ON_ERROR_STOP=1 "$@" 2>&1; }
ok() { if [ "$2" = "$3" ]; then echo "PASS $1"; PASS=$((PASS+1)); else echo "FAIL $1: got [$2] want [$3]"; FAIL=$((FAIL+1)); fi; }
F="-f $BASE/00_slug_function.sql"
reset() { Q -c "drop table if exists settings; create table settings(id serial primary key, salon_name text, public_slug text);
  create unique index settings_public_slug_key on settings(public_slug) where public_slug is not null;" >/dev/null; Q -c "$1" >/dev/null; }
snap() { Q -c "select md5(string_agg(id||':'||coalesce(public_slug,'∅'),',' order by id)) from settings"; }
NAMES=("Studio Één" "Salon Bloem & Co" "  BEAUTY   lounge " "Café Noïr" "Nail-Bar_24/7" "Ångström Spa" "Œuvre Beauté" "ﬁne Hair" "Kelvin K Salon" "İstanbul Kuaför" "Salon Ø" "日本 Salon" "Hair—by Ann")

# 1. SQL slug == server slug for tricky names
for n in "${NAMES[@]}"; do
  js=$(bun -e 'const s=v=>v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");console.log(s(process.argv[1]))' "$n")
  sq=$(Q $F -c "select pg_temp.gs_slug(\$q\$$n\$q\$)")
  ok "same slug as server: $js" "$sq" "$js"
done

# 2. happy path: fill, keep existing, rerun, post-check
reset "insert into settings(salon_name,public_slug) values ('Studio Één',null),('Salon Bloem & Co',''),('  BEAUTY   lounge ',null),('Café Noïr','eigen-keuze'),('Ångström Spa',' ');"
ok "dry run ok" "$(Q $F -f $BASE/01_dry_run.sql | tail -1)" "total=5 missing=4 already_set=1 empty_derived=0 duplicate_after=0 same_name_salons=0 set_differs_from_name=1 verdict=OK"
ok "wrong expected stops" "$(Q -1 -v expected=3 $F -f $BASE/02_backfill.sql | grep -c STOP)" "1"
ok "nothing written after stop" "$(Q -c "select count(*) from settings where public_slug is null or btrim(public_slug)=''")" "4"
Q -1 -v expected=4 $F -f $BASE/02_backfill.sql >/dev/null
ok "filled" "$(Q -c "select string_agg(public_slug,',' order by id) from settings")" "studio-een,salon-bloem-co,beauty-lounge,eigen-keuze,angstrom-spa"
ok "existing kept" "$(Q -c "select public_slug from settings where salon_name='Café Noïr'")" "eigen-keuze"
S1=$(snap); Q -1 -v expected=0 $F -f $BASE/02_backfill.sql >/dev/null
ok "rerun changes nothing" "$(snap)" "$S1"
ok "post check" "$(Q $F -f $BASE/03_post_check.sql | tail -1)" "total=5 missing=0 address_ok=4 address_wrong=0 duplicates=0"

# 3. existing addresses (as typed/encoded in a browser) still find the same salon
for u in "Studio%20%C3%89%C3%A9n" "studio-een" "STUDIO-EEN" "Studio Een" "studio--een-"; do
  dec=$(bun -e 'const s=v=>v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");console.log(s(decodeURIComponent(process.argv[1])))' "$u")
  ok "address $u" "$(Q -c "select salon_name from settings where public_slug='$dec'")" "Studio Één"
done
ok "salon with own slug: old name address no longer stored (reported)" "$(Q -c "select count(*) from settings where public_slug='cafe-noir'")" "0"

# 4. conflicts stop everything
reset "insert into settings(salon_name) values ('Studio Een'),('studio één'),('Ander');"
ok "similar names: dry run STOP" "$(Q $F -f $BASE/01_dry_run.sql | grep -o 'verdict=.*')" "verdict=STOP"
ok "similar names: backfill stops" "$(Q -1 -v expected=3 $F -f $BASE/02_backfill.sql | grep -c 'same link')" "1"
ok "similar names: 0 written" "$(Q -c "select count(public_slug) from settings")" "0"
reset "insert into settings(salon_name,public_slug) values ('A','salon-x'),('Salon X',null);"
ok "collides with existing: stops" "$(Q -1 -v expected=1 $F -f $BASE/02_backfill.sql | grep -c collide)" "1"
ok "collides: untouched" "$(Q -c "select count(public_slug) from settings")" "1"
reset "insert into settings(salon_name) values ('!!!'),(null),('Goed');"
ok "no usable name: stops" "$(Q -1 -v expected=3 $F -f $BASE/02_backfill.sql | grep -c 'no usable name')" "1"
ok "no usable name: 0 written" "$(Q -c "select count(public_slug) from settings")" "0"

# 5. rollback
reset "insert into settings(salon_name) values ('Studio Één'),('Bloem');"
S0=$(snap); Q -1 -v expected=2 $F -f $BASE/02_backfill.sql >/dev/null
Q -c "update settings set public_slug='zelf-gekozen' where salon_name='Bloem'" >/dev/null
ok "rollback refuses after later change" "$(Q -1 -v expected=2 $F -f $BASE/04_rollback.sql | grep -c STOP)" "1"
Q -c "update settings set public_slug='bloem' where salon_name='Bloem'" >/dev/null
Q -1 -v expected=2 $F -f $BASE/04_rollback.sql >/dev/null
ok "rollback restores exact state" "$(snap)" "$S0"
