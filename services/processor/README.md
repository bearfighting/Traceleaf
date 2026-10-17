# Processor

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

The Rust Processor reads stored raw events and Site capabilities from PostgreSQL, normalizes event context, and writes the facts and aggregates queried by Analytics API. It supports service operation and explicit processing/rebuild CLI workflows; it is not the ingestion HTTP service.

## Local development

The workspace uses Rust `1.98.1` from `rust-toolchain.toml`. Start the local processing stack with `pnpm docker:processing`. Run checks from the repository root:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:processor:postgres
```

## Operations

`DATABASE_URL` is supplied by the Compose or deployment environment. Database schema changes belong to the standalone `db-migrator`; services do not migrate at startup. PostgreSQL test commands use isolated test databases. See [Operations](../../docs/operations.md#database-migrations-and-tests) and [PostgreSQL test isolation](../../docs/testing/postgres-test-isolation-plan.md).

See the [project overview](../../README.md) and [project status](../../docs/project-status.md) for project boundaries and release state.
