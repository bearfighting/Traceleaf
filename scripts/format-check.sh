#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cargo fmt --all -- --check

pnpm exec prettier --check package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs compose.yaml compose.backend.yaml compose.dev.yaml compose.e2e.yaml docker/README.md protocol/README.md protocol/events protocol/contexts protocol/capabilities protocol/contracts/analytics-api protocol/contracts/http-ingestion/current protocol/contracts/configuration/current protocol/scenarios packages scripts/e2e-analytics.mjs scripts/e2e-configuration.mjs scripts/e2e-cache.mjs scripts/e2e-dashboard.mjs scripts/e2e-dev-startup.mjs scripts/e2e-router-compose.mjs scripts/validate-protocol.mjs scripts/validate-contract-layout.mjs scripts/validate-configuration-contract.mjs scripts/validate-capabilities.mjs scripts/validate-analytics-api-contract.mjs scripts/validate-http-fixtures.mjs scripts/router-targets.mjs scripts/router-targets.test.mjs scripts/dev.mjs scripts/dev-compose.mjs scripts/dev-compose.test.mjs scripts/dev-seed.mjs scripts/dev-seed.test.mjs scripts/docker-dev.mjs README.md .github/workflows tests
exec pnpm --recursive --if-present format:check
