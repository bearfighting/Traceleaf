# configuration-runtime

[English](README.md) | [项目概览](../../README.zh-CN.md)

此 Rust crate 提供 Collector、Processor 和 Analytics API 共用的运行时配置契约及 PostgreSQL 配置加载能力。它是内部 workspace crate，不是独立服务。

## 开发

workspace 使用 `rust-toolchain.toml` 锁定的 Rust `1.98.1`。

```bash
pnpm check
pnpm test
pnpm build
```

配置契约定义在 [`protocol/contracts/configuration/current/`](../../protocol/contracts/configuration/current/README.md)。运行时权威来源和迁移要求见 [ADR-014](../../docs/decisions/ADR-014-runtime-configuration-authority.md)及[运维指南](../../docs/operations.md)。
