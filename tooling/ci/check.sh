#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test -p analytics-api --test module_boundaries

pnpm --filter @web-analytics/protocol-ts typecheck
pnpm --filter @web-analytics/observer-core typecheck
pnpm --filter @web-analytics/analytics-core typecheck
pnpm --filter @traceleaf/browser typecheck
pnpm --filter @web-analytics/transport typecheck
pnpm exec eslint packages --config eslint.config.mjs
pnpm --filter @web-analytics/nextjs-router-playground typecheck
pnpm --filter @web-analytics/nextjs-router-playground lint
pnpm --filter @web-analytics/react-router-playground typecheck
pnpm --filter @web-analytics/tanstack-router-playground typecheck
pnpm --filter @web-analytics/vue-playground --filter @web-analytics/svelte-playground --filter @web-analytics/solid-playground --filter @web-analytics/angular-playground --filter @web-analytics/astro-playground typecheck
pnpm --filter @web-analytics/playground-support typecheck
pnpm --filter @web-analytics/dashboard typecheck
pnpm --filter @web-analytics/dashboard lint
pnpm format:check
