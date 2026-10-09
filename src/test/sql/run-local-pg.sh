#!/usr/bin/env bash
# Round 7: run the PROPOSED gateway SQL against a throwaway, fully local PostgreSQL.
# Isolation guarantees:
#  * every PG* env var is stripped (env -i), so no managed/production connection settings leak in;
#  * fresh initdb cluster in /tmp, TCP disabled (listen_addresses=''), unix socket in a private dir;
#  * cluster is destroyed afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BASE=/tmp/glowsuite-pg-round7
RUNUID=4711
rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"; chown -R $RUNUID:$RUNUID "$BASE"; chmod 700 "$BASE/sock"
AS() { env -i PATH="$PATH" HOME=/tmp setpriv --reuid=$RUNUID --regid=$RUNUID --clear-groups "$@"; }
AS initdb -D "$BASE/data" -U testsuper -A trust >/dev/null
AS pg_ctl -D "$BASE/data" -l "$BASE/log" -o "-c listen_addresses='' -k $BASE/sock" -w start >/dev/null
trap 'AS pg_ctl -D "$BASE/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$BASE"' EXIT
export PSQLX="psql -X -q -v ON_ERROR_STOP=1 -h $BASE/sock -U testsuper"
AS $PSQLX -d postgres -c "create database gs_round7_test" >/dev/null
cp "$HERE/round7-mocks.sql" "$HERE/round7-tests.sql" "$ROOT/docs/proposed-migrations/2026-10-09_whatsapp_gateway_receiver.sql" "$BASE/"
chown $RUNUID "$BASE"/*.sql
echo "== isolation =="
AS $PSQLX -d gs_round7_test -At -c "select 'socket_dir='||current_setting('unix_socket_directories')||' listen='''||current_setting('listen_addresses')||''' db='||current_database()||' tables_in_public='||(select count(*) from pg_tables where schemaname='public')"
AS $PSQLX -d gs_round7_test -f "$BASE/round7-mocks.sql"
AS $PSQLX -d gs_round7_test -f "$BASE/2026-10-09_whatsapp_gateway_receiver.sql"
echo "== tests =="
AS env PSQLX="$PSQLX" BASE="$BASE" bash "$HERE/round7-tests.sh"
