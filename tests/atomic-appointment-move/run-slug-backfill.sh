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
reset() { Q -c "drop table if exists settings; create table settings(id uuid primary key, user_id uuid, created_at timestamptz, is_demo boolean default false, salon_name text, public_slug text);
  create unique index settings_public_slug_key on settings(public_slug) where public_slug is not null;" >/dev/null; Q -c "$1" >/dev/null; }
snap() { Q -c "select md5(string_agg(id||':'||coalesce(public_slug,'∅'),',' order by id)) from settings"; }
LIVE=11111111-0000-0000-0000-000000000001
V="-v live_user=$LIVE"
# row helper: n = salon number (hex), name, created day, slug
row() { echo "('aa00000$1-0000-0000-0000-000000000000','11111111-0000-0000-0000-00000000000$1','2026-01-0$3','$2',$4)"; }
DRY() { Q $V -f $BASE/01b_dry_run_readonly_inline.sql | tail -1; }
FILL() { Q -1 -v expected=$1 $V $F -f $BASE/02_backfill.sql; }
SLUGF='lower(regexp_replace(normalize(x, NFKD), $r$[\u0300-\u036f]$r$, $r$$r$, $r$g$r$))'
JS() { bun -e 'const s=v=>v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");console.log(s(decodeURIComponent(process.argv[1])))' "$1"; }
# server lookup (current and new server share it): public_slug = slugify(addr) OR public_slug = addr; current server
# additionally falls back to the name only when nothing is stored.
NEWS() { local n; n=$(JS "$1"); Q -c "select coalesce((select salon_name from settings where public_slug in (\$q\$$n\$q\$, \$q\$$1\$q\$) limit 1),'NOT_FOUND')"; }
CURS() { local r; r=$(NEWS "$1"); if [ "$r" = NOT_FOUND ]; then local n; n=$(JS "$1"); Q $F -c "select coalesce((select salon_name from settings where pg_temp.gs_slug(salon_name)=\$q\$$n\$q\$ limit 1),'NOT_FOUND')"; else echo "$r"; fi; }
NAMES=("Studio Één" "Salon Bloem & Co" "  BEAUTY   lounge " "Café Noïr" "Nail-Bar_24/7" "Ångström Spa" "Œuvre Beauté" "ﬁne Hair" "Kelvin K Salon" "İstanbul Kuaför" "Salon Ø" "日本 Salon" "Hair—by Ann")

# 1. SQL slug == server slug for tricky names
for n in "${NAMES[@]}"; do
  js=$(bun -e 'const s=v=>v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");console.log(s(process.argv[1]))' "$n")
  sq=$(Q $F -c "select pg_temp.gs_slug(\$q\$$n\$q\$)")
  ok "same slug as server: $js" "$sq" "$js"
done

# 2. production-shaped fiction: live salon + 1 demo with same name (group B), 5 demos same name (group A), 2 unique
SEED="insert into settings(id,user_id,created_at,salon_name,public_slug) values
 $(row 1 'Glans Kliniek Noord' 5 null), $(row 2 'GLANS kliniek  noord' 1 null),
 $(row 3 'Demo Salon' 4 null), $(row 4 'demo salon' 2 null), $(row 5 'Démo  Salon!' 3 null), $(row 6 'DEMO-SALON' 6 null), $(row 7 'Demo Salón' 7 null),
 $(row 8 'Uniek Één' 1 null), $(row 9 'Bloem & Co' 1 "''"); update settings set is_demo=true where id::text like 'aa000002%';"
reset "$SEED"; S0=$(snap)
ok "dry run OK with 2 resolvable groups" "$(DRY)" "total=9 missing=9 empty_derived=0 conflict_groups=2 suffixed=5 duplicate_after=0 live_rows=1 live_plain=1 would_update=9 verdict=OK"
ok "dry run wrote nothing" "$(snap)" "$S0"
ok "wrong expected stops" "$(FILL 8 | grep -c STOP)" "1"
ok "nothing written after stop" "$(snap)" "$S0"
FILL 9 >/dev/null
ok "live keeps plain link (even though demo is older)" "$(Q -c "select public_slug from settings where user_id='$LIVE'")" "glans-kliniek-noord"
ok "demo in group B suffixed" "$(Q -c "select public_slug from settings where id::text like 'aa000002%'")" "glans-kliniek-noord-aa0000"
ok "group A: oldest keeps plain" "$(Q -c "select salon_name from settings where public_slug='demo-salon'")" "demo salon"
ok "group A: 4 suffixed" "$(Q -c "select count(*) from settings where public_slug like 'demo-salon-%'")" "4"
ok "unique salons plain" "$(Q -c "select string_agg(public_slug,',' order by public_slug) from settings where salon_name in ('Uniek Één','Bloem & Co')")" "bloem-co,uniek-een"
ok "post check" "$(Q $V $F -f $BASE/03_post_check.sql | tail -1)" "total=9 missing=0 own_ok=9 suffixed=5 plain_ok=4 live_plain=1 duplicates=0"
S1=$(snap); FILL 0 >/dev/null
ok "rerun changes nothing" "$(snap)" "$S1"
ok "dry run after fill" "$(DRY | grep -o 'missing=0.*would_update=0 verdict=OK' | wc -l)" "1"

# 3. addresses: live address variants on current and new server
for u in "glans-kliniek-noord" "Glans%20Kliniek%20Noord" "GLANS-KLINIEK-NOORD" "glans--kliniek-noord-" "Glans Kliniek Noord"; do
  ok "new server $u -> live" "$(NEWS "$u")" "Glans Kliniek Noord"
  ok "current server $u -> live" "$(CURS "$u")" "Glans Kliniek Noord"
done
for u in "Uniek%20%C3%89%C3%A9n" "UNIEK-EEN" "bloem-co" "Bloem%20%26%20Co"; do
  ok "new server $u found" "$(NEWS "$u" | grep -vc NOT_FOUND)" "1"
done
ok "suffixed demo link works on both" "$(NEWS glans-kliniek-noord-aa0000)|$(CURS GLANS-KLINIEK-NOORD-AA0000)" "GLANS kliniek  noord|GLANS kliniek  noord"
reset "$SEED"
ok "before fill: current server for live address is ambiguous (2 matching salons)" "$(Q $F -c "select count(*) from settings where pg_temp.gs_slug(salon_name)='glans-kliniek-noord'")" "2"
ok "before fill: new server finds nothing" "$(NEWS glans-kliniek-noord)" "NOT_FOUND"

# 4. unexpected conflicts stop everything
reset "insert into settings(id,user_id,created_at,salon_name,public_slug) values $(row 1 'Salon X' 1 null), $(row 2 'A' 1 "'salon-x'");"
ok "collides with existing: dry STOP" "$(DRY | grep -o 'verdict=.*')" "verdict=STOP"
ok "collides with existing: fill stops" "$(FILL 1 | grep -c collide)" "1"
ok "collides: untouched" "$(Q -c "select count(public_slug) from settings")" "1"
reset "insert into settings(id,user_id,created_at,salon_name,public_slug) values $(row 1 'Goed' 1 null), $(row 2 '!!!' 1 null), ('aa000003-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000003','2026-01-01',null,null);"
ok "no usable name: STOP" "$(FILL 3 | grep -c 'no usable name')" "1"
ok "no usable name: 0 written" "$(Q -c "select count(public_slug) from settings")" "0"
reset "insert into settings(id,user_id,created_at,salon_name,public_slug) values $(row 2 'Demo' 1 null), $(row 3 'Demo' 2 null);"
ok "live salon missing: dry STOP" "$(DRY | grep -o 'live_rows=0.*STOP' | wc -l)" "1"
ok "live salon missing: fill stops, 0 written" "$(FILL 2 | grep -c 'live salon')|$(Q -c "select count(public_slug) from settings")" "1|0"
reset "insert into settings(id,user_id,created_at,salon_name,public_slug) values $(row 1 'Demo' 1 null), $(row 2 'Demo' 2 null), ('aa000002-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003','2026-01-03','Demo-',null);"
ok "suffix collision (same id prefix): STOP, 0 written" "$(FILL 3 | grep -c collide)|$(Q -c "select count(public_slug) from settings")" "1|0"

# 5. rollback
reset "$SEED"; S0=$(snap); FILL 9 >/dev/null
Q -c "update settings set public_slug='zelf-gekozen' where salon_name='Bloem & Co'" >/dev/null
ok "rollback refuses after later change" "$(Q -1 -v expected=9 $F -f $BASE/04_rollback.sql | grep -c STOP)" "1"
Q -c "update settings set public_slug='bloem-co' where salon_name='Bloem & Co'" >/dev/null
Q -1 -v expected=9 $F -f $BASE/04_rollback.sql >/dev/null
ok "rollback restores (all links empty again, '' becomes null)" "$(Q -c "select count(public_slug) from settings")" "0"
