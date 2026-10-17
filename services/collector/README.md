# Collector

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

The Rust Collector receives browser event batches, validates the HTTP ingestion contract and Site policy, applies Origin and ingest-key checks and rate limits, enriches supported country context, and persists accepted raw events to PostgreSQL. It does not perform analytics aggregation.

## Local development

The workspace uses Rust `1.98.1` from `rust-toolchain.toml`. Start the supported backend workflow with `pnpm docker:backend` or the full PostgreSQL processing stack with `pnpm docker:processing`. The default listener is `0.0.0.0:4001`; configure listener values through CLI arguments. Runtime Site policy is loaded from PostgreSQL.

Run the unified Rust workspace checks from the repository root. For the isolated PostgreSQL integration tests, use the component command:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:collector:postgres
```

## Configuration and security

The Collector requires an operator-provided MMDB at `GEOIP_DATABASE_PATH` (Compose default: `./data/GeoLite2-Country.mmdb`); Compose does not download the database. Requests require an allowed Origin and configured `X-Ingest-Key`; policy and key material handling are described in [Operations](../../docs/operations.md) and the [HTTP ingestion fixtures](../../protocol/contracts/http-ingestion/current/fixtures/accepted-single-event.json). Services do not run schema migrations at startup; use the standalone `db-migrator` first.

See [Getting Started](../../docs/getting-started.md), [Operations](../../docs/operations.md), and [project status](../../docs/project-status.md).
