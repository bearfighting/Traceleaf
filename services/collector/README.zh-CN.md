# Collector

[English](README.md) | [项目概览](../../README.zh-CN.md)

Rust Collector 接收浏览器事件批次，校验 HTTP ingestion 契约和站点策略，执行 Origin 与 ingest key 检查及限流，补充支持的国家/地区上下文，并将接受的原始事件写入 PostgreSQL。它不负责分析聚合。

## 本地开发

workspace 使用 `rust-toolchain.toml` 锁定的 Rust `1.98.1`。使用 `pnpm docker:backend` 启动受支持的后端环境，或使用 `pnpm docker:processing` 启动完整 PostgreSQL 处理栈。默认监听 `0.0.0.0:4001`；监听地址通过 CLI 参数配置。运行时站点策略从 PostgreSQL 加载。

从仓库根目录运行统一 Rust workspace 检查。隔离 PostgreSQL 集成测试使用组件命令：

```bash
pnpm check
pnpm test
pnpm build
pnpm test:collector:postgres
```

## 配置与安全

Collector 需要运营人员通过 `GEOIP_DATABASE_PATH` 提供 MMDB（Compose 默认路径：`./data/GeoLite2-Country.mmdb`）；Compose 不会下载数据库。请求必须具有允许的 Origin 和已配置的 `X-Ingest-Key`；策略和密钥处理说明见[运维指南](../../docs/operations.md)及 [HTTP ingestion fixture](../../protocol/contracts/http-ingestion/current/fixtures/accepted-single-event.json)。服务启动时不会运行数据库迁移；应先使用独立的 `db-migrator`。

另见 [Getting Started](../../docs/getting-started.md)、[运维指南](../../docs/operations.md)和[项目状态](../../docs/project-status.md)。
