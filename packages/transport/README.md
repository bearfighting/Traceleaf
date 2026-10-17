# @web-analytics/transport

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

This internal TypeScript workspace package implements the Browser SDK's event delivery boundary. It provides the transport implementation consumed by the SDK and playground support; it does not observe navigation or define protocol schemas.

## Development

From the repository root:

```bash
pnpm --filter @web-analytics/transport build
pnpm --filter @web-analytics/transport typecheck
pnpm --filter @web-analytics/transport test
```

The package depends on `analytics-core` and `protocol-ts`. Protocol schemas remain authoritative in [`protocol/`](../../protocol/README.md). This is not a separately published consumer package. See the [Browser SDK integration guide](../../docs/browser-sdk-integration-plan.md) and [project status](../../docs/project-status.md).
