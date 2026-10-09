#!/usr/bin/env bash
# Round 8C: run the PROPOSED send-claims/nonces SQL against a throwaway, fully local PostgreSQL.
# Isolation: env -i strips every PG* variable; fresh initdb in /tmp; TCP off (listen_addresses='');
# private unix socket; cluster destroyed afterwards. Never touches GlowSuite or Gateway databases.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BASE=/tmp/glowsuite-pg-round8c
RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
export PSQLX="psql -X -q -v ON_ERROR_STOP=1 -h $BASE/sock -U testsuper"
AS $PSQLX -d postgres -c "create database gs_round8c_test" >/dev/null
cat > "$BASE/mocks.sql" <<'SQL'
-- TEST-ONLY: Supabase roles emulated in an empty local cluster.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
SQL
cp "$ROOT/docs/proposed-migrations/2026-10-10_whatsapp_send_claims_nonces.sql" "$BASE/proposal.sql"
chown $RUNUID "$BASE"/*.sql
echo "== isolation =="
AS $PSQLX -d gs_round8c_test -At -c "select 'socket_dir='||current_setting('unix_socket_directories')||' listen='''||current_setting('listen_addresses')||''' db='||current_database()||' tables_in_public='||(select count(*) from pg_tables where schemaname='public')"
AS $PSQLX -d gs_round8c_test -f "$BASE/mocks.sql"
AS $PSQLX -d gs_round8c_test -f "$BASE/proposal.sql"
echo "== tests =="
AS env PSQLX="$PSQLX" bash "$HERE/round8c-tests.sh"
