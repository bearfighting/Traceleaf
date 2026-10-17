# @web-analytics/observer-core

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

Framework-neutral navigation contracts, the in-memory observer used by tests
and development, and the browser Navigation API observer used by the Browser
SDK.

The browser observer reports the initial document and committed same-document
navigation entries. It does not depend on a Router library or intercept
navigations. When the Navigation API is unavailable, it reports only the initial
document. Shared navigation helpers preserve the `NavigationObserver` contract
across browser and in-memory observers.

## Development and verification

From the repository root, run these build and verification commands:

```bash
pnpm --filter @web-analytics/observer-core build
pnpm --filter @web-analytics/observer-core typecheck
pnpm --filter @web-analytics/observer-core test
```

The observer does not implement analytics, sessions, or transport. See [ADR-022](../../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md).
