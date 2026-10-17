# db-migrator

[English](README.md) | [项目概览](../../README.zh-CN.md)

此 Rust workspace 工具负责 PostgreSQL schema 的创建和升级。启动依赖新 schema 的服务版本前，必须先部署并完成迁移。Collector、Processor 和 Analytics API 启动时不会自行迁移数据库。

## 本地使用

workspace 使用 `rust-toolchain.toml` 锁定的 Rust `1.98.1`。标准开发入口为 `pnpm db:migrate`，使用仓库 Compose 数据库配置。迁移工具需要 `DATABASE_URL`；目标环境部署流程请遵循运维手册。

```bash
pnpm check
pnpm test
pnpm build
pnpm test:migrations
```

生产迁移前应备份并核实目标数据库。PostgreSQL 测试使用隔离数据库。详见[数据库迁移与测试](../../docs/operations.md#database-migrations-and-tests)和[迁移目录说明](../../db/migrations/README.md)。
