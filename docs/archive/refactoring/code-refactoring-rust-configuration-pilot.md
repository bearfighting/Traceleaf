# Rust 配置运行时与服务边界重构试点

本记录对应[代码重构 Checklist 工作包 4](./code-refactoring-checklist.md#工作包-4rust-configuration-runtime-和服务边界)。本工作包先完成共享 `configuration-runtime`，再整理 Collector HTTP 请求边界，最后整理 Analytics API configuration handler 与 store。重构保持现有外部行为和数据库结构；如果发现需要改变业务语义，应另立任务和设计决策。

## 工作包 4.1 实施前复核（2026-10-06）

本节是源码、调用方、测试和脚本的静态复核记录；未修改 Rust 代码，也未运行产品测试。

### 范围与依赖方向

- `crates/configuration-runtime/src/lib.rs` 当前同时是 crate API façade 和实现文件：定义 `CapabilitySnapshot`、`CapabilitySchemaValidator`、`CapabilityRuntime` 及存储配置私有类型；已有 `registry.rs`、`views.rs`，crate consumers 通过 `configuration_runtime` 导入公开类型。
- Runtime 被 Collector、Analytics API 和 Processor 使用。`CapabilityRuntime::spawn()` 在 Collector main、Analytics API routes 和 Processor 初始化路径启动周期刷新；`refresh_once()` 同时由 API/Processor 的显式路径和测试调用。实现没有返回 task handle，因此模块搬移时不得悄然改变启动次数、周期、生命周期或刷新结果。
- Collector 的 `http.rs` 提供 `router*` 构造函数并组装 `AppState`。`events` 负责请求体和 content-type 限制、JSON 解码、batch/site 提取、Origin/key 授权、rate limit、capability/runtime gate、可选 Geo enrichment、batch validation 和 sink 写入；`preflight`、CORS、响应类型及错误映射也在同一文件。现有 policy/security/rate-limit/validation/geo/sink 模块是下游职责，不应反向依赖 Axum handler。
- Analytics API 的路由在 `site_management/routes.rs`，授权和 state 由现有模块提供。`site_management/configuration.rs` 持有 capability/policy/key/definition 请求处理、precondition/schema/semantic validation、响应/ETag/effective-state 和 store 错误映射；`config_store.rs` 持有 SQL、版本冲突、事务、audit 与 runtime applied-state 查询。`configuration-runtime` 的 view/parser 被服务层调用，不依赖 handler 或数据库 store。
- 页面以外的 HTTP/API、数据库 schema 和 Collector 策略均属于行为边界；工作包只整理 Rust 内部职责，不改变 Dashboard API routes、protocol、migration 或数据语义。

### 可独立审查的实施边界

1. **Configuration runtime crate。** 将 snapshot 与 activation-window 不变量、schema/registry validator、PgPool runtime/refresh/report 实现从 `lib.rs` 移入职责清楚的私有模块；`lib.rs` 继续声明模块并 re-export 当前公开 API。保留现有 `registry.rs`、`views.rs` 及其导出。
2. **Collector HTTP adapter。** 保留 `collector::http` 路径和 `router` / `router_with_geo` / `router_with_capabilities` 的可见性与调用方式。按路由组装、请求处理阶段、CORS/response/error 等确有稳定边界的职责拆分；event pipeline 保持在一处可读的顺序编排，不将每个小函数机械拆成模块。
3. **Analytics API configuration handler。** 将 endpoint/use-case 编排与 precondition、验证、response projection、key material/error 映射分开到有实际领域含义的模块；保留 `site_management` 路由调用的 handler 边界以及现有错误语义。不把 SQL 放进 handler，也不让 store 反向依赖 handler。
4. **Analytics API configuration store。** 按 capability、environment policy/key、definition revision 和 applied-state 等实际事务/修改边界整理大文件。每项写入的 SQL 集合及事务边界要先列出再搬移；不创建通用 CRUD/storage 框架，不重写 migration。

这些边界可分别审查和回退。具体模块文件名和私有可见性由每个子切片在阅读完整调用链、测试和 Rust module rules 后确定；不为缩短文件而制造只有一次调用的层级。

### 必须保护的行为清单

- Runtime：schema 与 capability registry 校验；Site/version 身份；Page Views 必选、planned capability 禁用、依赖约束；enabled capability 必须有 activation window；数据库读取失败时保留 last-good snapshot 并标 stale；单 Site 文档无效只影响对应 snapshot；applied-version/instance reporting 和定时清理；`REFRESH_INTERVAL` 与 `spawn()` 调用契约。
- Collector：`/health`、`/v1/events`、OPTIONS route；body 和 batch 上限；JSON/content-type 错误；CORS/preflight；site/origin/key 拒绝语义；限流 key/阈值；生产 capability runtime 无 snapshot 时的 fail-closed 行为；capability gating 和 Page View redaction；validation/Geo 顺序；sink 原子写入和响应状态。
- Analytics API handler：AdminAuth、路径 identity、`If-Match` / `If-None-Match` 解析、ETag、schema 与领域校验、effective-state projection、错误 status/body；一次性 key 明文只由创建响应返回，持久化只保存 digest；definition revision/effective time 和 immutable ID 语义。
- Store：乐观并发冲突、unique constraint 映射、audit 记录及其与主修改的事务关系、policy origin 唯一性、key create/revoke 的版本更新、definition revision 与既有 ID 保留。所有 rollback 和晚期写失败行为维持现状。

### 测试映射

- Runtime：`configuration-runtime/src/lib.rs` 现有单测覆盖 identity/flags、planned capability、fixtures、schema、stale snapshot 和 activation windows；Consumer 覆盖包括 `services/collector/tests/runtime_policy_postgres.rs` 与 `services/analytics-api/tests/http.rs` 的 runtime/effective-state 场景。
- Collector：`services/collector/src/http.rs` 内 handler tests 覆盖请求限制、拒绝/接受、CORS、capability 和 sink；`services/collector/tests/http_ingestion.rs` 覆盖外部请求、Origin/key/site 和 rate limit；`runtime_policy_postgres.rs` 覆盖数据库运行时策略。
- Analytics API：`site_management/configuration.rs`、`config_store.rs` 内单测覆盖校验、序列化和错误；`services/analytics-api/tests/module_boundaries.rs` 限制 Rust module 依赖；`services/analytics-api/tests/http.rs` 的 PostgreSQL configuration scenarios 覆盖鉴权、policy/key、capability effective-state、immutable definition revisions 和失败行为。
- PostgreSQL 集成测试需已迁移数据库和 `DATABASE_URL`；相关测试标记为 ignored，由 `pnpm test:integration` 统一执行。E2E `pnpm e2e:configuration` 用于保留从配置管理到 runtime/Collector 的工作流证据。

### 开始实现前需实证确认

- `CapabilityRuntime::spawn()` 的实际启动次数和 Tokio runtime/shutdown 行为；`refresh_once()` 的执行是否可能重叠，以及失败时每类 snapshot/report 更新的精确时序。静态调用点已盘点，但取消和并发影响尚未动态验证。
- `config_store.rs` 中每个写操作的 `begin`、SQL、audit、`commit` 对应关系；unique violation 与并发版本竞争的 rollback/错误映射，按操作逐一记录。已有测试可保护行为，但当前边界文档没有逐操作事务清单。
- Collector 的请求阶段次序由 `events` 及 `validate_batch` 联合实现；移动时先画阶段顺序和每个拒绝阶段的状态码/CORS 结果，不能只根据 helper 函数顺序推断。
- 子切片如果发现现有测试未锁定上述不变量，先为既有行为添加最小保护测试，再移动实现；不要在本工作包顺手修改安全、存储或业务策略。

### 验收命令与未运行项规则

- 子切片可先运行 `cargo test -p configuration-runtime`、`cargo test -p collector` 或 `cargo test -p analytics-api`，以及对应 ignored PostgreSQL 场景；测试选择和限制应记入收尾记录。
- 最终通过仓库统一脚本：`pnpm check`（Rust fmt/clippy 和 module-boundary 等检查）、`pnpm test`（workspace tests）、`pnpm build`（workspace build）。不要用单 crate 测试替代最终 workspace 检查。
- 对 PostgreSQL ignored integration tests 运行 `pnpm test:integration`；需要提供 `DATABASE_URL`、运行 migration，并如实记录环境限制。
- 运行 `pnpm e2e:configuration`。若无法运行，记录服务/凭据/浏览器限制和替代证据，不标记为通过。
- 本次实施前复核没有运行上述命令；工作包关闭前依据实际变更边界和执行结果更新 checklist。

## 工作包 4.2 configuration-runtime 模块化（2026-10-06）

已将 `CapabilitySnapshot` 与 `CapabilitySchemaValidator` 移入 `capability_snapshot.rs`，将 PostgreSQL-backed `CapabilityRuntime` 的刷新、stale 标记、applied-state/instance reporting 和周期清理移入 `runtime.rs`；原 crate 单元测试集中到 `test_support.rs`。`lib.rs` 现在仅声明模块并 re-export 原有公共类型，继续导出 `REFRESH_INTERVAL`，调用方导入路径和 `CapabilityRuntime` 方法契约不变。

静态 review 确认 schema preflight 与 capability registry 校验顺序、site/version 身份、Page Views/implemented/dependency 约束及 activation-window 校验仍由 snapshot 构造路径执行；refresh 仍保留 last-good snapshot、按站点 stale 状态、逐站点与实例报告、小时清理以及 5 秒后台刷新周期。未调整数据库查询/报告内容或调用方。

### 验证结果

- `cargo test -p configuration-runtime`：通过，12 项通过，0 失败。
- 定向 Clippy（`cargo clippy -p configuration-runtime --all-targets --all-features -- -D warnings`）：通过。
- `cargo fmt --all -- --check`：通过。
- `git diff --check`：通过。
- 未运行 workspace 检查、PostgreSQL 集成测试或 configuration E2E；这些仍留待 4.6，不视为通过。

## 工作包 4.4 Analytics API configuration handler（2026-10-06）

已将 `site_management/configuration.rs` 的 capability、definition、ingest key 和 ingest policy 请求处理按资源整理到 `configuration/` 子模块。precondition、projection、validation、store error mapping 等共享职责有独立模块，相关单元测试归组到 `configuration/tests.rs`。路由入口仍由 `site_management/routes.rs` 调用原有 handler 边界；HTTP 契约、ETag/条件请求、错误映射和一次性 Ingest Key 语义保持不变。该切片未调整 SQL 或存储事务边界。

### 验证结果

- `cargo test -p analytics-api`：通过；15 个需要 PostgreSQL 的 HTTP 测试因数据库要求标记为 ignored，本次未执行。
- Analytics API 定向 Clippy：通过。
- Rust 格式检查：通过。
- `git diff --check`：通过。
- `pnpm check`：未能完成，执行时报告 `unable to open database file`。
- 未运行 Rust workspace 全量检查、PostgreSQL 集成测试和 `pnpm e2e:configuration`；这些整体验收留待 4.6，不视为通过。

## 工作包 4.5 Analytics API configuration store（2026-10-06）

已将 `config_store.rs` 整理为资源职责模块：`capabilities.rs` 持有 capability 读写及 activation-window 更新；`environment_policies.rs` 持有环境策略与 Ingest Key 生命周期；`applied_state.rs` 持有 Collector/Capability runtime applied-state 查询；`definition_revisions.rs` 持有不可变定义 revision、ID 保留和专属 audit。`config_store.rs` 保留 crate 内 façade、共享 `ConfigurationRow` / `StoreError`、数据库错误映射、通用 audit 与版本/时间/document helper。现有调用路径、`pub(crate)` API 和序列化测试保持不变。

搬移时保留原有 SQL 顺序和事务边界：capability/policy/key 写入仍在单个事务内按原顺序读取并加行锁（原有 create 操作除外）、校验版本、更新记录及 activation window（适用时）、写 audit 并 commit；定义创建/更新仍在事务开始后获取 `definition-revision:` advisory transaction lock，再检查/读取 revision、写入新 revision、写 audit 并 commit。版本冲突仍发生于持锁读取之后；约束错误映射、digest 字段、effective-state 查询、定义版本生成与既有 ID 保留未变。未修改 schema、migration 或 handler/API 契约。

### 验证结果

- `cargo test -p analytics-api`：通过，25 个库单测、3 个 HTTP 测试和 2 个 module-boundary 测试通过；HTTP 集成测试中 15 项因要求 PostgreSQL/`DATABASE_URL` 标记为 ignored，未执行。
- `cargo fmt --all` 与 `cargo fmt --all --check`：通过。
- 定向 Analytics API Clippy（`cargo clippy -p analytics-api --all-targets --all-features -- -D warnings`）：通过。
- `git diff --check`：通过。
- `pnpm check`：通过；ESLint 输出 5 条既有 generated protocol 文件的 unused-disable warnings，无 errors。此前 4.4 记录中的 `unable to open database file` 阻碍未在本次复现。
- 未运行 PostgreSQL 集成测试、Rust workspace 全量检查或 `pnpm e2e:configuration`；这些仍留待 4.6，不视为通过。

## 工作包 4.3 Collector HTTP 请求边界（2026-10-06）

已将 `http.rs` 保留为稳定 `collector::http` 路由入口和 `AppState` 组装 façade；事件处理移至 `http/events.rs`，OPTIONS preflight 移至 `http/preflight.rs`，health/error/response/CORS helper 移至 `http/response.rs`，原 HTTP 单测按 routing、request、batch validation、capabilities 分组至 `http/tests/`。`router`、`router_with_geo`、`router_with_capabilities` 的签名与路径不变。

静态复核确认事件请求顺序为：检查 `Content-Type`、限制并读取 body、解析 JSON、提取并一致性检查 site ID、site/origin/key 授权、按 site/origin 限流、读取 capability snapshot 并按 capability 决定 Geo enrichment、batch schema/字段校验、capability gate、`occurred_at` 时间范围校验、按 capability 裁剪 visitor/context 数据、构造 `StoredEvent` 并调用 sink。全批事件仍在一次 sink `accept` 中提交；sink 按批次失败映射为原有错误响应。preflight 仍只允许配置中的 Origin、POST、Content-Type/X-Ingest-Key；错误响应的 status/code、允许来源的 CORS header 和 `Vary: Origin` 行为由现有测试保护。未发现需要修复的行为缺口，未改变 Collector 策略或 API。

### 验证结果

- `cargo test -p collector`：通过；65 项通过、0 失败、1 项 ignored。另有 14 项 HTTP ingestion 集成测试和 1 项 key CLI 测试通过；PostgreSQL migration/storage/runtime-policy 测试共 9 项因需 PostgreSQL 而 ignored。
- `cargo clippy -p collector --all-targets --all-features -- -D warnings`：通过。
- `cargo fmt --all -- --check`：通过。
- `git diff --check`：通过。
- 未运行 PostgreSQL 集成测试、Rust workspace 全量检查或 `pnpm e2e:configuration`；PostgreSQL 场景及 configuration E2E 仍留待工作包 4.6，未计作通过。工作包 4 保持开放，4.6 状态不变。

## 工作包 4.6 整体验收与关闭（2026-10-06）

本节为最终整体验收记录；4.2–4.5 子切片中“仍留待 4.6”的表述记录的是各子切片结束时的状态，已由本节验收结果更新。工作包 4.3 的末尾状态说明同样是 4.3 当时的状态，当前已关闭。

### 边界复核

- `configuration-runtime/src/lib.rs` 仅声明私有模块、re-export 原有公开类型，并保留 `REFRESH_INTERVAL`；snapshot/schema、runtime 和 crate 单测分别位于 `capability_snapshot.rs`、`runtime.rs`、`test_support.rs`。Collector 与 Processor/Analytics API 的既有 crate 依赖方向未改变。
- 对 4.1 提出的 runtime 生命周期疑问做了最终复核：Collector main、Processor 初始化和 Analytics API router 各有一个既有 `CapabilityRuntime::spawn()` 调用；刷新循环在一次 `refresh_once()` 完成后才 sleep 并开始下一轮，未改变为并发循环。E2E 实际启动并停止了三项服务，PostgreSQL integration 覆盖 refresh 成功、数据库策略变化及无效刷新保留 last-good 的行为。当前没有专门断言 Tokio task cancellation/shutdown 时序的测试；本切片没有改 task 所有权或服务 shutdown 路径，因此将该项保留为既有运行时限制，而非重构回归。
- `collector::http` 保持稳定入口、`AppState` 和三个公开 router 构造函数；events、preflight、response 与 tests 位于子模块。HTTP 层调用 policy/security/rate-limit、runtime、validation、Geo 和 sink，不要求下游模块反向依赖 Axum handler。
- Analytics API 的 configuration handler 继续通过 `routes.rs` 调用原有 handler 接口；资源 handler 与 precondition、validation、projection、store error mapping 分模块。Store façade 保留 `pub(crate)` 调用面、共享 row/error 和 database/audit/version helper；资源 SQL 模块不依赖 handler。
- workspace `module_boundaries` 测试通过。错误映射维持原有 handler/store 语义；本次没有扩展 crate/service 公共 API，没有改 API、协议、schema 或 migration。store SQL 与事务/锁/audit 顺序由 4.5 的逐项复核和完整 PostgreSQL integration tests 覆盖。
- 测试归属与职责一致：runtime 单测在 configuration-runtime，HTTP 行为测试在 Collector `http/tests/`，Analytics API handler/store 单测留在相应子模块测试，跨模块约束在 `tests/module_boundaries.rs`，数据库行为由 integration tests 覆盖。

### 最终验证结果

- `pnpm check`：通过，包含 Rust workspace fmt/clippy、module boundaries、TS 检查、lint 与格式检查。ESLint 有 5 条 generated protocol 文件的既有 unused-disable warnings，0 errors。
- `pnpm test`：通过，Rust workspace、Dashboard（54 个文件/271 项）及其余 package/tooling tests 均通过。无数据库时的 15 个 Analytics API PostgreSQL cases 在此命令中按设计 ignored，之后由 integration suite 实际执行。
- `pnpm build`：通过，Rust workspace、Next.js 应用和各 package/playground 构建通过。
- `pnpm test:integration`：通过，针对 runner 管理的隔离 E2E PostgreSQL 数据库运行 migration 后执行；Collector `postgres_storage` 7 项、`runtime_policy_postgres` 1 项、`analytics_metadata_migration` 1 项、Processor 16 项、canonical fixtures 1 项、Analytics API HTTP configuration/API 15 项通过，0 失败。全程没有连接本地开发数据库。临时 Compose database、volume、network 随后由 runner 清理。
- `pnpm e2e:configuration`：通过，配置管理到 Collector/runtime 的 workflow 验证完成；suite 自行创建并清理隔离环境。
- `git diff --check`：通过。

### 关闭结论

工作包 4.2–4.5 的模块边界复核和 4.6 要求的 workspace、PostgreSQL integration、configuration E2E 验收均已完成。没有发现由本次职责搬移造成的失败或需修复缺口；外部行为、数据库结构和事务语义保持不变。唯一未专门测试的是既有 Tokio task 的 cancellation/shutdown 时序，相关服务调用和循环结构经源码复核未改变。按本工作包的验收范围，工作包 4 关闭。
