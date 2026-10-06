#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required for PostgreSQL integration tests." >&2
  exit 1
fi

pnpm db:migrate
cargo test -p collector --test postgres_storage -- --ignored --test-threads=1
cargo test -p collector --test runtime_policy_postgres -- --ignored --test-threads=1
cargo test -p collector --test analytics_metadata_migration -- --ignored --test-threads=1
cargo test -p processor --test processor -- --ignored --test-threads=1
cargo test -p processor --test canonical_fixtures -- --ignored --test-threads=1
cargo test -p analytics-api --test http -- --ignored --test-threads=1
