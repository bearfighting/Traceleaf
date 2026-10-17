# Processor

[English](README.md) | [项目概览](../../README.zh-CN.md)

Rust Processor 从 PostgreSQL 读取已存储的原始事件和站点能力，归一化事件上下文，并写入供 Analytics API 查询的事实表和聚合数据。它支持服务运行和显式处理/重建 CLI 工作流，但不是 HTTP ingestion 服务。

## 本地开发

workspace 使用 `rust-toolchain.toml` 锁定的 Rust `1.98.1`。使用 `pnpm docker:processing` 启动本地处理栈。在仓库根目录运行检查：

```bash
pnpm check
pnpm test
pnpm build
pnpm test:processor:postgres
```

## 运维

`DATABASE_URL` 由 Compose 或部署环境提供。数据库 schema 变更由独立 `db-migrator` 负责；服务启动时不会迁移。PostgreSQL 测试命令使用隔离测试数据库。详见[运维指南](../../docs/operations.md#database-migrations-and-tests)和 [PostgreSQL 测试隔离](../../docs/testing/postgres-test-isolation-plan.md)。

项目边界和发布状态见[项目概览](../../README.zh-CN.md)和[项目状态](../../docs/project-status.md)。
