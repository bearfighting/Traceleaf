#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

cargo build --workspace

pnpm --filter @web-analytics/protocol-ts --filter @web-analytics/observer-core --filter @web-analytics/analytics-core --filter @traceleaf/browser --filter @web-analytics/transport --filter @web-analytics/playground-support build
pnpm --filter @web-analytics/nextjs-router-playground build
pnpm --filter @web-analytics/react-router-playground --filter @web-analytics/tanstack-router-playground build
pnpm --filter @web-analytics/vanilla-playground build
pnpm --filter @web-analytics/vue-playground --filter @web-analytics/svelte-playground --filter @web-analytics/solid-playground --filter @web-analytics/angular-playground --filter @web-analytics/astro-playground build
pnpm --filter @web-analytics/dashboard build
pnpm --filter @traceleaf/website build
