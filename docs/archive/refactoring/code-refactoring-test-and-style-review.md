# 集成测试与全局样式复核

本记录对应[代码重构 Checklist 工作包 7](./code-refactoring-checklist.md#工作包-7-剩余大型测试css-和候选复核)，覆盖 Analytics API HTTP 集成测试、已有 Processor 测试分组、Dashboard 全局 CSS，以及相关活跃候选的处置。

## 7.1 实施前复核

### Analytics API HTTP 集成测试

`services/analytics-api/tests/http.rs` 当前约 2,420 行，包含 18 个 `#[tokio::test]`：15 个 PostgreSQL-backed ignored tests，以及 3 个普通测试。`test:integration` 以同一个 `http` integration target、`--ignored --test-threads=1` 串行执行前 15 个；普通测试由常规 Cargo test 执行。拆分保留根文件作为 Cargo target，并在其下创建行为模块：

| 模块                 | 场景                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `analytics_reports`  | 报表聚合与 query validation、health/error、Geo、历史数据在缺少 Registry metadata 时的行为 |
| `site_management`    | 管理认证、站点创建、idempotency replay/conflict/concurrency 和事务回滚                    |
| `configuration`      | capability、policy、ingest key、定义 revision 的管理 API 行为                             |
| `capability_runtime` | runtime effective state、版本和 validator refresh 行为                                    |

共享 pool、response body、site/capability seed、reset、router 和管理配置 fixture helper 继续留在 target 根模块，子模块通过 `super` 使用；不新增数据库夹具框架或生产 API。

必须保持共享 PostgreSQL 的串行执行、所有测试名与 ignored 属性、固定 site 清理/seed 顺序、并发创建及故障注入的事务断言。根 target 名称仍为 `http`，因此 `pnpm test:integration` 的命令无需改变。

### Processor、Collector tests 和 CSS

- Processor 测试已在工作包 5 按事件处理、显式 rebuild/definitions、generation/queue/rollback 分入 `tests/processor/`，`tests/processor.rs` 仍作为 target 入口。`generation_rebuild.rs` 虽仍约 756 行，但共享 generation/queue 状态和并发/回滚不变量紧密耦合；进一步拆成多个文件会增加跨模块导航，保留为一个行为组。
- Collector `http_ingestion.rs` 约 411 行；handler unit tests 靠近 `src/http.rs`，database storage 与 runtime policy 各有独立 integration targets。当前测试按 ingest request/lifecycle 分组清楚，保留。
- `apps/dashboard/styles.css` 约 968 行，由根 layout 全局导入；文件先定义 Tailwind theme/base，接着一个 components layer，最后集中覆盖 responsive selectors。候选视觉域有 shell/reports、configuration/definitions、site onboarding 和 responsive behavior，但多个域共享 theme tokens、base rules 和尾部断点覆盖。进一步拆分前需确认 CSS import 与 Tailwind expansion 后的 cascade 顺序及真实 Dashboard 布局；不得只按长度搬移。

## 7.2 HTTP 测试拆分记录

四组测试位于 `services/analytics-api/tests/http/`。根 target 文件 `http.rs` 保留全部共享 helper 和 Cargo target 名称；各行为模块通过 `use super::*` 访问既有 helper。函数名、测试属性、assertions、seed/reset 代码和数据库串行约束均随原测试一起搬移。`cargo test -p analytics-api --test http -- --list` 列出 18 项；ignored 标记数量与之前一致。`cargo test -p analytics-api --test http --no-run` 编译通过。隔离 PostgreSQL 18.6 上 15 个 ignored 测试全部通过；常规 target 执行结果为 3 passed、15 ignored。

## 7.3 CSS 与剩余候选决策

Dashboard CSS 拆为主题、base、dashboard layout、navigation、analytics reports、dashboard overview、dashboard settings、site creation 和 responsive 九个文件；`styles.css` 保持单一全局入口。Dashboard 主导航、设置标签、Analytics sidebar、移动菜单、报表锚点和报表链接集中在 `dashboard-navigation.css`；报表展示规则保留在 `analytics-reports.css`；连接状态和站点概览规则位于 `dashboard-overview.css`；站点配置/密钥/定义编辑规则保留在 `dashboard-settings.css`。Overview 文件排在报告样式之后，保留 `.card` 通用规则早于 `.card.site-overview-card` 的来源次序；viewport overrides 仍由最后导入的 responsive 文件提供。最终归档后的 build 和 Dashboard E2E 均通过。

Processor / Collector 保留理由见 7.1。生成文件通过生成源维护；实验目录按实验生命周期维护；migration SQL 是历史记录；协议/schema/canonical fixture 是契约或验证输入，不因为体积本身搬移。其余大文件按候选清单保留原有职责：没有发现能在不复制状态、依赖或行为边界的前提下独立拆出的稳定职责，本工作包不为行数目标新增模块。

## 验收记录

### 工作包 7 验收（2026-10-07）

- 环境：Node `26.10.0`、pnpm `12.6.0`、Rust `1.98.1`；HTTP 数据库测试使用独立 PostgreSQL `18.6` 容器和 `15449` 端口，没有连接开发 `.env` 数据库。测试结束后移除独立容器。
- HTTP 测试：`cargo test -p analytics-api --test http --no-run` 编译通过；普通 target 为 3 passed、15 ignored；隔离 DB 命令 `DATABASE_URL=... cargo test -p analytics-api --test http -- --ignored --test-threads=1` 为 15 passed、0 failed。target 名称、函数名、ignored 标记及共享 seed/reset/helper 保持。
- CSS：最终全局入口保留 Tailwind、主题、base、layout、navigation、reports、overview、settings、site creation、responsive 顺序。最终 CSS 文件布局下 `pnpm build` 通过；`pnpm e2e:dashboard` 的 17 个 workflow 全部通过，含真实浏览器 Web Vitals、响应式 shell、报表和设置场景；E2E runner 清理了 Compose 容器、网络和 volume。导航样式测试读取 `dashboard-navigation.css`。
- 全仓：最终归档后的 `pnpm check`、`pnpm test`、`pnpm format:check`、`pnpm format:check:docs`、`cargo fmt --all -- --check` 和 `git diff --check` 均通过。Dashboard 54 test files、271 tests passed；`pnpm check` 有 5 条既有 generated protocol unused-disable warnings，没有 errors。首次 `pnpm test` 曾发现 sidebar 测试读取旧入口，现已迁移断言至 `dashboard-navigation.css`，定向及全仓测试通过。
- 候选复核：Processor 继续沿用工作包 5 的分组；Collector HTTP tests、generation rebuild tests、生成代码、实验目录、历史 migration 和 canonical fixtures 保留或按源维护，职责/约束依据见 7.1。没有因行数增加无职责边界的切分。
- 未覆盖范围：本工作包仅复跑受 CSS 影响的 Dashboard E2E，不重跑其他七个 E2E suite；migration clean/upgrade/rollback suite 由工作包 6.6 验收覆盖，本工作包只需运行 Analytics API HTTP target 的隔离数据库用例。

局部复核确认根 `http` target 只保留共享测试上下文及模块注册；四个测试模块按行为域组织。CSS 导入入口、overview 卡片次序和响应式覆盖顺序保持，导航及 overview 规则分别集中到职责文件。最终归档后的定向/全仓测试、构建和浏览器验收均通过。工作包 7 完成并关闭。
