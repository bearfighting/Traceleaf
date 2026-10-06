#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

cargo fmt --all -- --check

pnpm exec prettier --check package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs compose.yaml compose.backend.yaml compose.dev.yaml compose.e2e.yaml docker/README.md protocol/README.md protocol/events protocol/contexts protocol/capabilities protocol/contracts/analytics-api protocol/contracts/http-ingestion/current protocol/contracts/configuration/current protocol/scenarios packages tooling db tests README.md .github/workflows
exec pnpm --recursive --if-present format:check
