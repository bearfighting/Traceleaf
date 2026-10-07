#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
echo "Running the migration runner against the current schema..."
pnpm db:migrate

echo "Running the migration runner a second time to verify idempotency..."
pnpm db:migrate

echo "Running the db-migrator migration history regression test..."
cargo test -p db-migrator --test migrations -- --ignored --test-threads=1
