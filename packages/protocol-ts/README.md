# @web-analytics/protocol-ts

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

TypeScript interfaces mirroring the unified initial Event Protocol and Browser
Context contract. JSON Schema remains the protocol source of truth.

This package contains no runtime browser or framework dependencies.

The package contains only protocol types; Visitor ID generation and Browser
Context collection remain runtime SDK responsibilities.

## Development and verification

From the repository root, run these build and verification commands:

```bash
pnpm --filter @web-analytics/protocol-ts build
pnpm --filter @web-analytics/protocol-ts typecheck
pnpm --filter @web-analytics/protocol-ts test
pnpm protocol:validate
```

See [`protocol/`](../../protocol/README.md) and [ADR-023](../../docs/decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md).
