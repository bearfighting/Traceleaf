# @web-analytics/playground-support

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

Shared TypeScript utilities for the repository's browser and framework playgrounds, including the mock delivery path used to exercise navigation and event creation locally. This package supports examples; it is not a production analytics integration or Router adapter.

## Development

```bash
pnpm --filter @web-analytics/playground-support build
pnpm --filter @web-analytics/playground-support typecheck
pnpm e2e:navigation-api
```

The workspace package depends on `analytics-core`, `protocol-ts`, and `transport`. See the [playground index](../../examples/README.md), [Navigation API decision](../../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md), and [project status](../../docs/project-status.md).
