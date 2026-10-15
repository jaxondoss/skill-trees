# Shared helpers: throwaway local Postgres with the Supabase stub and all migrations applied.
# Usage: source this file, then: pg_start <port>; pg_psql -c '...'; pg_stop (also run on EXIT).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "Postgres server binaries not found. Set PG_BIN." >&2
  exit 1
fi

# initdb refuses to run as root; drop to the postgres user when needed.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

pg_start() {
  PG_PORT="$1"
  PG_WORK="$(mktemp -d)"
  chmod 777 "$PG_WORK"
  as_pg "$PG_BIN/initdb" -D "$PG_WORK/data" -U postgres --auth=trust >/dev/null
  as_pg "$PG_BIN/pg_ctl" -D "$PG_WORK/data" -o "-p $PG_PORT -k $PG_WORK -c listen_addresses=''" -l "$PG_WORK/log" -w start >/dev/null
  PSQL=("$PG_BIN/psql" -h "$PG_WORK" -p "$PG_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

  # Seed template as JSON, straight from the TypeScript source.
  (cd "$ROOT" && pnpm exec tsx -e 'import { SEED_TEMPLATE } from "./src/seed/template"; process.stdout.write(JSON.stringify(SEED_TEMPLATE))') > "$PG_WORK/template.json"
  chmod 644 "$PG_WORK/template.json"

  "${PSQL[@]}" -f "$ROOT/tests/db/supabase-stub.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "applying $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  done

  # Expose the template to SQL as a database-level setting.
  local template_sql
  template_sql="$(sed "s/'/''/g" "$PG_WORK/template.json")"
  "${PSQL[@]}" -c "alter database postgres set forge.template = '$template_sql'"
}

pg_psql() { "${PSQL[@]}" "$@"; }

pg_stop() {
  if [[ -n "${PG_WORK:-}" ]]; then
    as_pg "$PG_BIN/pg_ctl" -D "$PG_WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$PG_WORK"
    PG_WORK=""
  fi
}
