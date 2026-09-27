#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cargo fmt --all

pnpm exec prettier --write package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs compose.yaml compose.backend.yaml docker/README.md protocol/README.md protocol/events protocol/contexts protocol/capabilities protocol/contracts/analytics-api protocol/contracts/http-ingestion/current protocol/contracts/configuration/current protocol/scenarios packages scripts/e2e-analytics.mjs scripts/e2e-configuration.mjs scripts/e2e-dashboard.mjs scripts/e2e-router-compose.mjs scripts/validate-protocol.mjs scripts/validate-contract-layout.mjs scripts/validate-configuration-contract.mjs scripts/validate-capabilities.mjs scripts/validate-analytics-api-contract.mjs scripts/validate-http-fixtures.mjs scripts/router-targets.mjs scripts/dev.mjs scripts/docker-dev.mjs README.md docs/README.md docs/getting-started.md docs/event-protocol.md docs/protocol-consolidation-refactor.md docs/phase-1-design.md docs/phase-2-design.md docs/phase-3-design.md docs/phase-4-design.md docs/phase-5-design.md docs/phase-6-design.md docs/phase-8-design.md docs/phase-0-design.md docs/roadmap.md docs/ingest-key.md docs/router-playground.md docs/decisions .github/workflows/ci.yml tests
pnpm exec prettier --write docs/architecture-design.md docs/feature-modularization-design.md docs/mvp-scope.md docs/phase-7-design.md docs/phase-8-design.md docs/release-readiness-design.md
exec pnpm --recursive --if-present format
