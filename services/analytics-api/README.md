# Analytics API

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

The Rust Analytics API serves report queries and site-management operations. Analytics reads come from PostgreSQL processed facts and aggregates; the Dashboard accesses data through this API and does not connect to the database.

## Local development

The workspace uses Rust `1.98.1` from `rust-toolchain.toml`. Start the API as part of `pnpm docker:processing` or the full local stack with `pnpm dev:up`. The Compose development listener is `0.0.0.0:4002`.

```bash
pnpm check
pnpm test
pnpm build
pnpm test:analytics-api:postgres
```

## Configuration and security

`DATABASE_URL` and site-management credentials are supplied by the runtime environment. Protect management access as described in [Operations](../../docs/operations.md); do not expose administrative credentials in browser-visible configuration. The standalone `db-migrator` owns schema migrations.

See the [Analytics API contract cases](../../protocol/contracts/analytics-api/current/api-contract-cases.json), [Operations](../../docs/operations.md), and [project status](../../docs/project-status.md).
