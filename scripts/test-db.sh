#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local Postgres and runs tests/db/rls.sql.
# Needs Postgres 15+ server binaries (initdb, pg_ctl). Set PG_BIN to point at them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "Postgres server binaries not found. Set PG_BIN." >&2
  exit 1
fi

# initdb refuses to run as root; drop to the postgres user when needed.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

WORK="$(mktemp -d)"
chmod 777 "$WORK"
PORT="${PG_TEST_PORT:-54329}"
cleanup() {
  as_pg "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

as_pg "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
as_pg "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

# Seed template as JSON, straight from the TypeScript source.
(cd "$ROOT" && pnpm exec tsx -e 'import { SEED_TEMPLATE } from "./src/seed/template"; process.stdout.write(JSON.stringify(SEED_TEMPLATE))') > "$WORK/template.json"
chmod 644 "$WORK/template.json"

"${PSQL[@]}" -f "$ROOT/tests/db/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

# Expose the template to the test as a database-level setting.
TEMPLATE_SQL="$(sed "s/'/''/g" "$WORK/template.json")"
"${PSQL[@]}" -c "alter database postgres set forge.template = '$TEMPLATE_SQL'"

"${PSQL[@]}" -f "$ROOT/tests/db/rls.sql"
