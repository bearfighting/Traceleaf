# Analytics API 模块边界改造验收

本记录跟踪 Analytics API 分层迁移。HTTP 路径、JSON 契约、数据库 schema 和 migration 在本轮保持不变。

## 已验证

- `build_router(RouterConfig)` 保持为公共构造入口；路由构造没有启动周期刷新任务。
- Visitors 和 dimensions 报告现通过可注入的报告事务接口执行；PostgreSQL adapter 仍以 `REPEATABLE READ, READ ONLY` 开始事务。Fake transaction 覆盖 begin、read、commit 三种失败在两个报告用例中的 Storage 映射，并验证成功响应组装。
- Site Management PostgreSQL 操作已由 `PostgresSiteManagementAdapter` 提供；站点、配置和应用状态 HTTP handlers 通过注入的 application 用例接口访问。`SiteManagementState` 位于 application 层，不持有 `PgPool`；Site Management domain 不依赖 Axum、SQLx 或 storage，也不再重导出 PostgreSQL 模块。
- 模块边界测试覆盖 Site Management domain 的普通、分组、别名、通配导入、相对路径和路径引用违规，也检查 transport 的 pool/storage 访问。
- `cargo fmt --all -- --check`、`cargo clippy -p analytics-api --all-targets --all-features -- -D warnings` 和 `cargo test -p analytics-api --test module_boundaries` 通过。
- `cargo test -p analytics-api` 通过：35 个单元测试通过；需要 PostgreSQL 的 HTTP 测试在本次验证中保持 ignored，未作为通过证据。
- `pnpm e2e:analytics` 通过全部 10 个 fixture。原因是测试先写入 ingest policy、后复用运行中的 Collector；Collector 每 5 秒刷新一次策略快照。测试现在会在播种策略后重建其 Collector 和 Analytics API 服务。
- `pnpm http:validate` 和 `pnpm analytics:contract:validate` 通过；`git diff --check` 通过。
- `db/migrations/`、`db/tests/` 和 `protocol/` 无本轮 diff。

## 尚未完成

- 本轮已引入 Site Management repository port 和 application service，并将站点创建规范化、capability/policy/definition 校验、默认 capability document、site/environment identity 校验及 applied-state 聚合放入 application 层。
- Service fake repository 测试已覆盖站点首次创建、幂等重放/冲突、配置校验和 capability applied-state 查询部分失败；创建/更新/撤销配置的完整存储错误映射矩阵仍需补齐。
- 本轮没有启动 PostgreSQL 来运行 ignored HTTP 集成测试；应由后续 PostgreSQL 测试环境隔离工作提供安全、可重复的执行入口。

因此，分层迁移和当前无数据库验证已完成；完整 fake repository 错误矩阵及隔离 PostgreSQL HTTP 集成验证仍是后续验收项。
