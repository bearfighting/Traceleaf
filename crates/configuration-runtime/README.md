# configuration-runtime

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

This Rust crate provides shared runtime configuration contracts and PostgreSQL-backed configuration loading used by Collector, Processor, and Analytics API. It is an internal workspace crate, not a standalone service.

## Development

The workspace uses Rust `1.98.1` from `rust-toolchain.toml`.

```bash
pnpm check
pnpm test
pnpm build
```

Configuration contracts are defined under [`protocol/contracts/configuration/current/`](../../protocol/contracts/configuration/current/README.md). Runtime authority and migration requirements are documented in [ADR-014](../../docs/decisions/ADR-014-runtime-configuration-authority.md) and [Operations](../../docs/operations.md).
