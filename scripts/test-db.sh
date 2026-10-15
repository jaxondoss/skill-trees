#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local Postgres and runs the SQL tests in tests/db.
# Needs Postgres 15+ server binaries (initdb, pg_ctl). Set PG_BIN to point at them.
set -euo pipefail
source "$(dirname "$0")/lib/pg.sh"
trap pg_stop EXIT

pg_start "${PG_TEST_PORT:-54329}"
pg_psql -f "$ROOT/tests/db/rls.sql"
pg_psql -f "$ROOT/tests/db/functions.sql"
