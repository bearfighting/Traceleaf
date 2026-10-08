#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

bash ./tooling/db/postgres-test-run.sh migrations
bash ./tooling/db/postgres-test-run.sh collector
bash ./tooling/db/postgres-test-run.sh processor
bash ./tooling/db/postgres-test-run.sh analytics-api
