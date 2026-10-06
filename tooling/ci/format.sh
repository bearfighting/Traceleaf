#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

cargo fmt --all

pnpm exec prettier --write package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs compose.yaml compose.backend.yaml docker/README.md protocol/README.md protocol/events protocol/contexts protocol/capabilities protocol/contracts/analytics-api protocol/contracts/http-ingestion/current protocol/contracts/configuration/current protocol/scenarios packages tooling scripts db tests README.md docs .github/workflows
exec pnpm --recursive --if-present format
