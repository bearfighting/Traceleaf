# @web-analytics/analytics-core

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

Framework-neutral page-view event factory and synchronous `beforeSend` pipeline.

This package does not access browser APIs or send, buffer, or persist events.

## Development and verification

From the repository root, run these build and verification commands:

```bash
pnpm --filter @web-analytics/analytics-core build
pnpm --filter @web-analytics/analytics-core typecheck
pnpm --filter @web-analytics/analytics-core test
```

See the [protocol source of truth](../../protocol/README.md) and [project status](../../docs/project-status.md).
