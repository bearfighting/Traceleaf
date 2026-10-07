# E2E suite 与契约 tooling 重构试点

本记录对应[代码重构 Checklist 工作包 6](./code-refactoring-checklist.md#工作包-6-e2e-suite-与契约-tooling)。目标是缩小大型 E2E suites、contract validators 和 migration harness 的理解范围，同时保持命令、fixture、场景顺序、服务生命周期、失败诊断和数据库安全行为不变。

## 工作包 6.1 实施前盘点（2026-10-07）

### E2E suite 与 runner

- `tests/e2e/runner/cli.mjs` 负责按 registry 选择 suite、创建/复用共享 Compose 环境、suite 间 reset、串行运行和 teardown。`suite-registry.mjs` 定义公开 suite ID、脚本、依赖服务和共享环境策略；`environment.mjs` 管理隔离 project、端口、凭据及 runner lock。该层应保持为 suite orchestrator，不承载场景断言。
- Compose suites 使用 `e2e-compose.mjs` 共享 Compose 参数、运行输出、迁移和 project removal；suite 特有的浏览器/page 生命周期、service startup、seed、诊断、场景验证仍留在 suite 层。
- 按文件规模及职责盘点出三个主要候选：`e2e-dashboard.mjs`（约 2,033 行，包含报表、空态/错误态、维度、配置、Web Vitals、definitions 和导航场景）、`e2e-analytics.mjs`（约 609 行，fixture ingest、Processor rebuild、API response 验证）、`e2e-configuration.mjs`（约 490 行，configuration/policy、event boundary 和 storage outage recovery）。子模块切分须以场景为单位保留各自资源 owner 与执行顺序。
- Analytics 与 Dashboard 共享部分 capability/policy seed 和 analytics fixture，但 Dashboard 还含浏览器页面与设置工作流；Configuration 通过管理 API 验证 policy/configuration lifecycle。仅提取窄而稳定的纯 helper，不能把 suite 特有 setup 合并成大而全的 fixture framework。

### Contract validator 与 migration harness

- 根 `package.json` 提供 `protocol:validate`、`capabilities:validate`、`http:validate`、`analytics:contract:validate`、`analytics:definitions:validate` 等稳定命令。拆分时保留现有 validator 路径作为 CLI facade，保留退出码、诊断格式、fixture 路径和 command ordering。
- 大型候选包括 `validate-analytics-api-contract.mjs`（约 716 行：OpenAPI/query cases、输入 events、聚合和 API response fixture 语义）、`validate-configuration-contract.mjs`（约 592 行：capability/policy/site-management schemas、semantic/migration cases 和 OpenAPI assertions）。`validate-http-fixtures.mjs`（约 333 行）和 `validate-protocol.mjs`（约 157 行）作为次级候选；拆分前应确认独立输入合同与可测试边界，短 validator 可保留单文件。
- `db/tests/test-migrations.sh`（约 866 行）覆盖当前 schema 幂等性、clean install、upgrade/legacy conversion、rollback/failure atomicity、对象与约束验证。`pnpm test:migrations` 和 `pnpm test:integration` 都运行 migration，但前者验证迁移历史和升级，后者运行 Collector、Processor、Analytics API 行为 suites；两者保持独立入口和 assertions。若按 migration 场景拆脚本，原入口继续控制临时数据库命名与 EXIT cleanup。

### 初始验证映射

- E2E runner：`node --test tests/e2e/runner/runner.test.mjs`，并按变更运行对应 `pnpm e2e:*` suite。
- Contract tooling：保留五个现有 package scripts，按变更运行对应 validator；运行 `pnpm check` 覆盖仓库命令组合。
- Migration：在 disposable PostgreSQL 上运行 `pnpm test:migrations` 和 `pnpm test:integration`；不连接本地开发库。
- 通用：对涉及文件运行 Prettier、相关静态检查和必要 workspace `pnpm check` / `pnpm test` / `pnpm build`。所有 E2E、migration 的实际通过数、环境和未覆盖项在 6.6 记录。

此盘点确定候选和不可变边界，不预先要求拆开每个文件；如果职责已清楚、独立模块会扩大跳转范围，应记录保留结论及理由。

## 工作包 6.2 Dashboard E2E suite 场景拆分（2026-10-07）

### 模块边界

- `tests/e2e/suites/e2e-dashboard.mjs` 继续是 suite 入口和资源 owner：负责 Compose 启停、seed、browser/page/tracing 生命周期、失败截图、trace、secret redaction、Compose diagnostics 与 teardown。
- `tests/e2e/suites/dashboard/reports.mjs` 承载 Dashboard shell、Page Views、Geo、站点隔离、日期范围及 audience dimensions 的断言和场景专属准备。
- `tests/e2e/suites/dashboard/events.mjs` 承载 Custom Events、Conversion/Funnel backfill 和 Web Vitals 报表的断言和场景专属准备。真实浏览器 Web Vitals 采集仍由 suite 入口在浏览器启动后、trace 开始前执行。
- `tests/e2e/suites/dashboard/settings.mjs` 承载 definitions、capability/policy/key 配置和 API error 的断言及专属准备。
- fixture 读取、事件入库、Processor 操作等共享 helper 留在 suite 入口，通过按职责收窄的依赖传入场景模块；场景模块不接收其他场景的断言回调。入口保留调用顺序、PASS 输出及所有资源生命周期。

### 验收记录

- `node --check` 覆盖 suite 入口和三个场景模块：通过；`node --test tests/e2e/runner/runner.test.mjs`：通过。
- `pnpm e2e:dashboard`：通过，17 个 workflow 均通过；隔离 Compose project 和 PostgreSQL 已由 runner 清理。原 PASS 顺序保持，覆盖真实浏览器 Web Vitals、Dashboard shell、Page Views、Geo、Custom Events、Conversion/Funnel backfill、definitions、Web Vitals report、多页/多站点隔离、空/自定义日期范围、audience dimensions、配置管理和 API error。
- `pnpm check`：通过。ESLint 输出包含 protocol-ts generated 文件 5 条 unused-disable warning，无 error。
- `pnpm test`：通过（应用与 package unit suites 全部通过；包含 Dashboard 54 个 test files、271 项测试）。
- `pnpm format:check`、`pnpm format:check:docs`：通过。
- 所有新增和修改的 `.mjs` 文件通过 `node --check`；涉及的 E2E 文件通过 Prettier。

Dashboard 6.2 切片通过。下一步再评估 Analytics 和 Configuration 的模块边界；本次不改其实现。

## 工作包 6.2.1 Processor Clippy 阻塞修复（2026-10-07）

- 按 Clippy 建议，将 `definition_revisions.rs`、`event_facts.rs`、`explicit_rebuilds.rs` 和 `generation_rebuild.rs` 中 9 处 `queries::lock_site` 调用改为自动解引用可处理的借用表达式。
- 修改仅涉及显式解引用；事务、锁调用位置及处理顺序均保持不变。
- `cargo fmt --all -- --check`：通过。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`：通过。
- `pnpm check`：通过。输出包含 protocol-ts 生成文件已有的 5 条 ESLint unused-disable warning，不影响退出状态。
- 本切片只修复 6.2.1 指定的静态检查阻塞；工作包 6.6 的整体验收仍待完成。

## 工作包 6.5 分切片验证与回归（2026-10-07）

验证在仓库根目录完成，Node 使用 `.node-version` 锁定的 `26.10.0`，pnpm 为 `12.6.0`。PostgreSQL 使用独立 `postgres:18.6-alpine3.23` 容器，数据库 URL 显式限定为 `127.0.0.1:15448`；没有读取或连接开发 `.env` 数据库。主机未安装 `psql`，因此仅在 `/tmp` 放置临时 psql wrapper，将 migration harness 的 psql 命令转发到该隔离容器；Rust migrator 和 integration suites 通过显式 `DATABASE_URL` 连接同一容器。

### 验收记录

- `pnpm protocol:validate`、`pnpm capabilities:validate`、`pnpm http:validate`、`pnpm analytics:contract:validate`、`pnpm analytics:definitions:validate` 和 `node tooling/contracts/check-contract-fixture-schema-baseline.mjs`：全部退出码为 0；覆盖协议、capability、30 个 HTTP fixtures、11 个 Analytics API fixtures、definitions 及 schema/fixture baseline。
- `pnpm e2e:dashboard`：通过，17 个 Dashboard workflow 均通过；E2E runner 清理其独立 Compose project 与 PostgreSQL volume。此命令在锁定 Node 26.10.0 下复跑通过。
- `pnpm check`、`pnpm test`、`pnpm format:check`：均通过（Node 26.10.0）。`pnpm check` 仍报告 5 条生成 protocol TypeScript 文件的 ESLint unused-disable warning，无 errors。普通 `pnpm test` 的脚本仍将需要数据库的测试标为 ignored；数据库覆盖由下面的 integration suite 提供。
- `pnpm test:migrations`：在 PostgreSQL 18.6 上通过，覆盖 current history/idempotency、clean install、upgrade、legacy conversion、失败原子回滚和 schema assertions。
- `pnpm test:integration`：在迁移后的同一隔离数据库通过：Collector PostgreSQL storage 7、runtime policy 1、analytics metadata migration 1、Processor 18、canonical fixture 1、Analytics API HTTP 15；合计 43 项通过，3 项按测试定义过滤。
- 清理故障注入：首次验证期间（host Node 26.2.0、pnpm 12.6.0），临时 cargo shim 在 upgrade 数据库创建后、升级迁移前针对 `20260924001200` 返回 97。入口按预期失败，随后查询 `pg_database` 确认 `analytics_migration_clean_*` 和 `analytics_migration_upgrade_*` 数据库数量为 0，证明 `EXIT` trap 清理了两者。该注入只针对隔离实例；正常 migration/integration 回归随后在锁定 Node 26.10.0 下通过。

这次验证没有运行所有 `pnpm e2e:*` suites，也没有运行 `pnpm build`；6.5 覆盖本工作包改动相关的 Dashboard suite、contract validators、workspace check/test/format 与 PostgreSQL suites。工作包 6.6 的整体验收和关闭仍待后续执行。

## 工作包 6.6 整体验收与关闭（2026-10-07）

验收使用 `.node-version` 锁定的 Node `26.10.0` 和 pnpm `12.6.0`。Dashboard E2E 由 runner 创建独立 Compose project、端口和 PostgreSQL volume；数据库 suites 使用单独的 `postgres:18.6-alpine3.23` 实例，绑定 `127.0.0.1:15448` 并通过显式 `DATABASE_URL` 连接，没有读取或连接开发 `.env` 数据库。主机没有 `psql`，migration harness 使用 `/tmp/wp66-bin/psql` 将 psql 命令转发至专用容器；检查确认临时 clean/upgrade database 已清理，完成后删除该专用容器。工作区原有 `wap-native-step3-*` 和 `web-analytics-platform-*` 容器未作为验收数据库使用。

### 验收结果

- `pnpm e2e:dashboard`：首次与 workspace 和数据库任务并行运行时，Settings 的成功状态 locator 等待超时；runner 保存 screenshot、Compose 状态和 service logs，并完成自身环境 teardown。检查日志确认 API 返回了预期的 policy create 成功响应。停止并行负载后串行重跑通过，17 个 workflow 全部通过，覆盖真实浏览器 Web Vitals、报表、隔离、日期范围、audience dimensions、配置和 API error。没有为该超时修改代码。成功运行清理了其专属 Compose project 和 PostgreSQL volume。
- 五个 validator 入口（`protocol:validate`、`capabilities:validate`、`http:validate`、`analytics:contract:validate`、`analytics:definitions:validate`）及 `node tooling/contracts/check-contract-fixture-schema-baseline.mjs`：全部退出码为 0。输出确认 30 个 HTTP fixtures 和 11 个 Analytics API fixtures 验证成功；协议、capability、configuration/OpenAPI、definitions 及 schema/fixture baseline 均通过。
- `pnpm test:migrations`：在隔离 PostgreSQL 18.6 上通过，覆盖 current history/idempotency、clean install、upgrade/legacy conversion、失败原子回滚和 schema assertions。首轮尝试误用了 `/tmp/psql` 中遗留且指向已删除容器的 wrapper；改用专用 `/tmp/wp66-bin/psql` 后全套通过。验收后查询 `pg_database`，没有 `analytics_migration_*` 临时数据库。6.5 的失败故障注入也已证明 upgrade 失败时入口 `EXIT` trap 清理 clean/upgrade 数据库。
- `pnpm test:integration`：在迁移后的同一隔离实例上通过，Collector storage 7、runtime policy 1、analytics metadata migration 1、Processor 18、canonical fixture 1、Analytics API HTTP 15，共 43 项通过、3 项按测试定义过滤。
- `pnpm check`、`pnpm test`、`pnpm format:check`、`pnpm format:check:docs`、`pnpm build`：全部退出码为 0。check 保留 5 条 generated protocol TypeScript 文件的 ESLint unused-disable warning，无 errors；Dashboard unit suite 为 54 files / 271 tests passed。build 完成 Rust workspace、packages、playgrounds 和 Dashboard 构建。
- 复核 `package.json` 中五个 validator 命令、`test:migrations`、`test:integration`、`e2e:dashboard` 入口，以及 `.github/workflows/quality.yml` 中 check/build/test、integration 的 migration 后 integration 调用顺序和 dashboard E2E suite 调用。入口、CLI、fixture、suite ID 和 CI suite grouping 均保持不变；没有公共 API 或接口变化。

本次只复跑了受改动影响的 Dashboard E2E suite；其余七个 E2E suites 未受本次重构影响，没有重复运行。最终必需验收项均通过，工作包 6 已关闭。
