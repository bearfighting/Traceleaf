#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

cargo build --workspace

pnpm --filter @web-analytics/protocol-ts --filter @web-analytics/observer-core --filter @web-analytics/observer-next --filter @web-analytics/observer-react-router --filter @web-analytics/observer-tanstack-router --filter @web-analytics/analytics-core --filter @web-analytics/analytics-browser --filter @web-analytics/transport --filter @web-analytics/router-adapters --filter @web-analytics/playground-support build
pnpm --filter @web-analytics/nextjs-router-playground build
pnpm --filter @web-analytics/react-router-playground --filter @web-analytics/tanstack-router-playground build
pnpm --filter @web-analytics/dashboard build
