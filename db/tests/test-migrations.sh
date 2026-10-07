#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required for migration regression tests." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for migration regression tests." >&2
  exit 1
fi

clean_database="analytics_migration_clean_${PPID}_$$"
upgrade_database="analytics_migration_upgrade_${PPID}_$$"
database_url_for() {
  node -e '
  const databaseUrl = new URL(process.argv[1]);
  databaseUrl.pathname = `/${process.argv[2]}`;
  process.stdout.write(databaseUrl.toString());
' "$1" "$2"
}
clean_database_url="$(database_url_for "$DATABASE_URL" "$clean_database")"
upgrade_database_url="$(database_url_for "$DATABASE_URL" "$upgrade_database")"

cleanup_upgrade_database() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$clean_database\" WITH (FORCE)" >/dev/null 2>&1 || true
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$upgrade_database\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup_upgrade_database EXIT

bash ./db/tests/migration-current-history.sh

echo "Creating an isolated clean database for first-install regression..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$clean_database\"" >/dev/null
DATABASE_URL="$clean_database_url" bash ./db/tests/migration-clean-install.sh

echo "Creating an isolated database for migration upgrade regression..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$upgrade_database\"" >/dev/null
DATABASE_URL="$upgrade_database_url" bash ./db/tests/migration-upgrade-behavior.sh

bash ./db/tests/migration-schema-assertions.sh "$clean_database_url" "$upgrade_database_url" "$DATABASE_URL"
echo "Migration regression passed."
