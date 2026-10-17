# db-migrator

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

This Rust workspace tool owns PostgreSQL schema creation and upgrades. Deploy and complete migrations before starting service versions that require the new schema. Collector, Processor, and Analytics API do not migrate the database at startup.

## Local use

The workspace uses Rust `1.98.1` from `rust-toolchain.toml`. The standard development entry point is `pnpm db:migrate`, which uses the repository's Compose database configuration. The migrator requires `DATABASE_URL`; use the operations runbook for target deployment procedures.

```bash
pnpm check
pnpm test
pnpm build
pnpm test:migrations
```

Back up and verify the intended database before production migration. PostgreSQL tests use isolated databases. See [database migrations and tests](../../docs/operations.md#database-migrations-and-tests) and [migration layout](../../db/migrations/README.md).
