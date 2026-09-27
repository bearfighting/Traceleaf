# MVP Release Readiness Design

> Status: Planned
> Scope: MVP 功能完成后的完整测试、稳定性、部署、迁移和发布验证

## 1. 阶段定位

Release Readiness 是 MVP 的最后阶段。它不新增产品功能，负责把 Phase 7 和 Phase 8 的结果验证为可以在干净环境中部署和发布的 Release Candidate。

功能开发期间仍需同步编写单元测试、fixture 和最小 E2E；本阶段负责完整回归矩阵和上线保障。

## 2. 执行顺序

```text
Protocol validation
  → migration regression
  → integration test
  → Analytics E2E
  → Dashboard E2E
  → browser matrix
  → runtime hardening
  → retention dry-run
  → deployment / backup / rollback
  → package release
  → clean-environment RC checklist
```

## 3. CI 基线

`validate` job 必须执行：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm test
pnpm build
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend \
  --profile storage \
  --profile processing \
  --profile dashboard \
  config --quiet
```

Rust 步骤必须有明确名称：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --workspace
```

本地和 CI 使用同一组入口命令：

```bash
pnpm check
pnpm format:check
pnpm test
pnpm build
pnpm test:migrations
pnpm test:integration
pnpm e2e:analytics
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm e2e:dashboard
pnpm --filter @web-analytics/analytics-browser pack --dry-run
```

## 4. PostgreSQL 和 migration

使用 PostgreSQL 18.6 验证：

- 空数据库首次 migration；
- migration 重复执行；
- `_sqlx_migrations` history、checksum 和描述；
- 核心表、索引和约束；
- 已有 history 升级到当前版本；
- integration test；
- 不修改已执行 SQL migration。

统一本地和 CI 命令：

```bash
pnpm test:migrations
pnpm test:integration
```

## 5. E2E 和浏览器矩阵

Analytics E2E 和 Dashboard E2E 使用独立 Compose project、端口和测试 volume，不删除开发数据库 volume。

失败时保留：

- Compose config；
- service status；
- migration、Collector、Processor、Analytics API 日志；
- Dashboard screenshot、trace 和 service diagnostics；
- 测试输出和 Processor 结果。

统一写入：

```text
artifacts/integration/
artifacts/analytics-e2e/
artifacts/dashboard-e2e/
```

Release Readiness 的目标浏览器矩阵至少覆盖 Chromium、Firefox 和 WebKit，并验证 SDK 初始化、consent、storage、navigation、transport 和 capability 事件。当前 CI 仍只执行 Chromium Dashboard smoke test；在 Release Readiness 实施后，CI 和本地 RC 验证必须使用同一组浏览器安装命令：

```bash
pnpm exec playwright install --with-deps chromium firefox webkit
```

现有仅安装 Chromium 的 `pnpm playwright:install` 只适用于当前 Dashboard smoke test，不代表完整浏览器矩阵。

## 6. Collector 和运行时 hardening

必须验证：

- body、header、Origin、Ingest Key 和 batch 限制；
- request、database acquire 和 shutdown timeout；
- 数据库不可用和恢复；
- SIGTERM 和容器停止；
- health/readiness 与 migration 状态；
- generic client error 和内部日志脱敏；
- 重复事件、失败响应和限流行为。

## 7. 数据生命周期

上线前必须完成 retention policy：

- Raw Events、Context、facts 和 aggregates 的保留关系；
- dry-run、候选数量和影响范围；
- 安全删除顺序；
- 部署将 db-migrator 的过期审计清理命令配置为至少每日运行，并验证过期行已删除；
- 中断、重试和一致性校验；
- 自动删除默认关闭，除非策略已批准。

如果策略尚未批准，Release Candidate 只能包含 dry-run 和一致性检查。

## 8. 部署和发布

部署顺序固定为：

```text
migration job
  → schema compatibility check
  → service deployment
  → health verification
```

文档必须覆盖：

- secrets、Origin、Ingest Key 和数据库权限；
- backup 和 restore；
- migration 失败处理；
- Geo country 部署验收：核验 DB-IP/GeoLite MMDB 官方 checksum、类型和 build epoch；在 staging 验证 Collector 启动、country/unknown 结果、离线原子更新与回滚，并记录聚合覆盖率/unknown 比例及数据库、日志无原始 IP。
- 服务镜像回滚；
- 目标 SDK package（当前为 `@web-analytics/analytics-browser`）的 metadata、类型入口和 pack 内容；
- 发布前移除目标 package 的 `private` 标记，并确认 workspace 依赖可以在发布包中被正确解析；
- 版本、变更记录、tag 和发布权限；
- 安装后的 smoke test。

## 9. Release Candidate 退出条件

- Phase 7 和 Phase 8 的 capability 与配置验收完成；
- Geo region/city 已明确延期至 MVP 之后；country Geo 的部署验收完成并记录结果；
- CI、migration、integration、Analytics E2E 和 Dashboard E2E 全部通过；
- 浏览器矩阵通过；
- SDK bundle size 和 package smoke test 通过；
- Collector runtime failure、shutdown、redaction 和 readiness 通过；
- retention policy 已批准，或自动删除已明确延期；
- 部署、backup、rollback 文档可由新环境执行；
- 目标 SDK package 的 `pnpm --filter @web-analytics/analytics-browser pack --dry-run` 和安装 smoke test 通过；
- 干净环境 RC checklist 完成并记录已知限制。
