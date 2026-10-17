# Analytics API

[English](README.md) | [项目概览](../../README.zh-CN.md)

Rust Analytics API 提供报表查询和站点管理操作。分析数据读取自 PostgreSQL 处理后的事实表和聚合数据；Dashboard 通过此 API 访问数据，不直接连接数据库。

## 本地开发

workspace 使用 `rust-toolchain.toml` 锁定的 Rust `1.98.1`。可通过 `pnpm docker:processing` 启动 API，或使用 `pnpm dev:up` 启动完整本地栈。Compose 开发监听地址为 `0.0.0.0:4002`。

```bash
pnpm check
pnpm test
pnpm build
pnpm test:analytics-api:postgres
```

## 配置与安全

`DATABASE_URL` 和站点管理凭据由运行环境提供。按照[运维指南](../../docs/operations.md)保护管理访问；不要将管理凭据暴露在浏览器可见配置中。数据库迁移由独立 `db-migrator` 负责。

详见 [Analytics API 契约用例](../../protocol/contracts/analytics-api/current/api-contract-cases.json)、[运维指南](../../docs/operations.md)和[项目状态](../../docs/project-status.md)。
