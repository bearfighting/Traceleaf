#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

cargo test --workspace

pnpm protocol:validate
node experiments/m0b/parity/run.mjs
pnpm capabilities:validate
node tooling/contracts/check-configuration-contract-parity.mjs
node tooling/ci/audit-policy-datetimes.mjs --fixtures
node tooling/contracts/generate-configuration-contract-types.mjs --check
pnpm analytics:contract:validate
pnpm analytics:definitions:validate
pnpm http:validate
if [[ "${WORKSPACE_BUILD_READY:-false}" != "true" ]]; then
  pnpm build:packages
fi
pnpm --filter @web-analytics/protocol-ts test
pnpm --filter @web-analytics/observer-core test
pnpm --filter @web-analytics/observer-next test
pnpm --filter @web-analytics/observer-react-router test
pnpm --filter @web-analytics/observer-tanstack-router test
pnpm --filter @web-analytics/router-adapters test
pnpm --filter @web-analytics/analytics-core test
pnpm --filter @web-analytics/analytics-browser test
pnpm --filter @web-analytics/transport test
pnpm --filter @web-analytics/nextjs-router-playground test
pnpm --filter @web-analytics/react-router-playground test
pnpm --filter @web-analytics/tanstack-router-playground test
pnpm --filter @web-analytics/playground-support test
pnpm --filter @web-analytics/dashboard test
node --test tooling/dev/router-targets.test.mjs
node --test tooling/contracts/capability-seed.test.mjs
node --test tooling/dev/dev-compose.test.mjs
node --test db/seeds/development/dev-seed.test.mjs
node --test tooling/db/postgres-test-target.test.mjs
node --test tests/e2e/support/e2e-database.test.mjs
