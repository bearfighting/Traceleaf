#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
echo "Applying all migrations to the clean database..."
DATABASE_URL="$DATABASE_URL" pnpm db:migrate
DATABASE_URL="$DATABASE_URL" pnpm db:migrate
DATABASE_URL="$DATABASE_URL" cargo test -p db-migrator --test migrations -- --ignored --test-threads=1
