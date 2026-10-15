#!/usr/bin/env bash
# Boots the full app against a local stand-in for Supabase, for Playwright:
#   Postgres (real migrations) + PostgREST + tests/e2e/stack/gateway.mjs (auth stub and REST proxy)
# then serves the app on the e2e port. One seeded user; tests sign in with a cookie.
# E2E_MODE=start serves a production build instead of next dev.
set -euo pipefail
source "$(dirname "$0")/lib/pg.sh"

cfg() { (cd "$ROOT" && node -e "import('./tests/e2e/stack/config.mjs').then(c => process.stdout.write(String(c.$1)))"); }
POSTGREST_VERSION="v12.2.3"
POSTGREST="${XDG_CACHE_HOME:-$HOME/.cache}/forge/postgrest-$POSTGREST_VERSION"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  pg_stop
}
trap cleanup EXIT

if [[ ! -x "$POSTGREST" ]]; then
  echo "downloading PostgREST $POSTGREST_VERSION"
  mkdir -p "$(dirname "$POSTGREST")"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" \
    | tar -xJ -O postgrest > "$POSTGREST"
  chmod +x "$POSTGREST"
fi

pg_start "$(cfg PG_PORT)"

USER_ID="$(cfg USER_ID)"
pg_psql <<SQL
create role authenticator login noinherit;
grant anon, authenticated to authenticator;
insert into auth.users (id, email) values ('$USER_ID', '$(cfg USER_EMAIL)');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$USER_ID', true) \g /dev/null
select public.seed_user(current_setting('forge.template')::jsonb) \g /dev/null
-- Onboarding confirms the suggested milestones; do the same here.
update public.milestones set claimed_at = now() where suggest_claim;
commit;
SQL

PGRST_DB_URI="postgres://authenticator@/postgres?host=$PG_WORK&port=$(cfg PG_PORT)" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$(cfg JWT_SECRET)" \
PGRST_SERVER_PORT="$(cfg POSTGREST_PORT)" PGRST_LOG_LEVEL=warn \
  "$POSTGREST" &
PIDS+=($!)
node "$ROOT/tests/e2e/stack/gateway.mjs" &
PIDS+=($!)

export NEXT_PUBLIC_SUPABASE_URL="$(cfg SUPABASE_URL)"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(cfg ANON_KEY)"
cd "$ROOT"
if [[ "${E2E_MODE:-dev}" == "start" ]]; then
  pnpm exec next build >/dev/null
  pnpm exec next start -p "$(cfg APP_PORT)"
else
  pnpm exec next dev -p "$(cfg APP_PORT)"
fi
