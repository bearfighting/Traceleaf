#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

component="${1:?component required}"
shift
if [[ -z "${TEST_POSTGRES_ADMIN_URL:-}" ]]; then
  export TEST_POSTGRES_ADMIN_URL="postgres://analytics_test:analytics_test@127.0.0.1:${TEST_POSTGRES_PORT:-55432}/postgres"
  docker compose -p web-analytics-test-postgres -f compose.test-postgres.yaml up -d --wait postgres
fi
if [[ "$component" == clean-stale ]]; then
  node --input-type=module -e 'import { assertPostgresTestAdminTarget } from "./tooling/db/postgres-test-target.mjs"; try { assertPostgresTestAdminTarget(process.argv[1]); } catch (error) { console.error(error.message); process.exit(1); }' "$TEST_POSTGRES_ADMIN_URL"
  while IFS= read -r database; do
    [[ -z "$database" ]] && continue
    if psql "$TEST_POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -Atq -c "SELECT 1 FROM pg_stat_activity WHERE datname = '$database' LIMIT 1" | rg -q '^1$'; then continue; fi
    psql "$TEST_POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\"" >/dev/null
    echo "Removed stale test database $database"
  done < <(psql "$TEST_POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -Atq -c "SELECT d.datname FROM pg_database d JOIN pg_shdescription c ON c.objoid=d.oid AND c.classoid='pg_database'::regclass WHERE d.datname ~ '^analytics_test_[a-z_]+_[a-z0-9_]+$' AND c.description ~ '^analytics-test-created-at=' AND substring(c.description from 27)::timestamptz < now() - interval '24 hours'")
  exit 0
fi
case "$component" in
  collector) tests=(
    "cargo test -p collector --test postgres_storage -- --ignored --test-threads=1"
    "cargo test -p collector --test runtime_policy_postgres -- --ignored --test-threads=1"
    "cargo test -p collector --test analytics_metadata_migration -- --ignored --test-threads=1"
  ) ;;
  processor) tests=(
    "cargo test -p processor --test processor -- --ignored --test-threads=1"
    "cargo test -p processor --test canonical_fixtures -- --ignored --test-threads=1"
  ) ;;
  analytics-api) tests=("cargo test -p analytics-api --test http -- --ignored --test-threads=1") ;;
  migrations) tests=() ;;
  *) echo "Unknown PostgreSQL test component." >&2; exit 2 ;;
esac

if ! command -v psql >/dev/null 2>&1; then echo "psql is required for PostgreSQL integration tests." >&2; exit 1; fi
run_id="$(node -e 'process.stdout.write(`${Date.now().toString(36)}_${process.pid.toString(36)}_${require("node:crypto").randomBytes(4).toString("hex")}`)')"
database="analytics_test_${component//-/_}_${run_id}"
node --input-type=module -e 'import { assertPostgresTestAdminTarget } from "./tooling/db/postgres-test-target.mjs"; try { assertPostgresTestAdminTarget(process.argv[1], process.argv[2]); } catch (error) { console.error(error.message); process.exit(1); }' "$TEST_POSTGRES_ADMIN_URL" "$database"

database_url="$(node -e 'const u=new URL(process.argv[1]);u.pathname=`/${process.argv[2]}`;process.stdout.write(u.toString())' "$TEST_POSTGRES_ADMIN_URL" "$database")"
created=0
cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  if [[ "$created" == 1 ]]; then
    psql "$TEST_POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null 2>&1 || echo "Could not clean test database $database; remove it manually after checking connections." >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM HUP
psql "$TEST_POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
created=1
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
psql "$TEST_POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE \"$database\" IS 'analytics-test-created-at=$created_at'" >/dev/null
echo "PostgreSQL test target: $database"
if [[ "$component" == migrations ]]; then
  DATABASE_URL="$database_url" TEST_RUN_ID="$run_id" bash ./db/tests/test-migrations.sh
else
  DATABASE_URL="$database_url" cargo run -p db-migrator
  for test_command in "${tests[@]}"; do DATABASE_URL="$database_url" bash -c "$test_command"; done
fi
