# Dashboard

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

The Dashboard is the operator-facing Next.js application for site administration and querying Analytics API reports. It uses the API for analytics and has no PostgreSQL connection of its own.

## Development

Requirements are the repository's Node.js and pnpm versions. From the repository root:

```bash
pnpm --filter @web-analytics/dashboard dev
```

For the supported local full-stack setup, use [`pnpm dev:up`](../../docs/getting-started.md); Compose provides the service URLs and development configuration.

## Checks and build

```bash
pnpm --filter @web-analytics/dashboard typecheck
pnpm --filter @web-analytics/dashboard lint
pnpm --filter @web-analytics/dashboard test
pnpm --filter @web-analytics/dashboard build
```

The package scripts are defined in `package.json`. The root `pnpm check`, `pnpm test`, and `pnpm build` run repository-wide workflows.

## Configuration and boundaries

Local and deployment configuration is supplied through the Compose environment. Do not put deployment secrets in browser-visible settings. The Dashboard server queries Analytics API; database access and report processing belong to backend services. Administrative site-management access uses the deployment configuration described in [Operations](../../docs/operations.md).

See [Getting Started](../../docs/getting-started.md), [Operations](../../docs/operations.md), and [project status](../../docs/project-status.md) for authoritative setup and release state.
