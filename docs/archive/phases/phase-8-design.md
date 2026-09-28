# Phase 8 Design — MVP 用户配置与能力管理

> Status: Complete — PR0–PR8 已实现并验收；后续进入 MVP Release Readiness。
> Scope: capability configuration、站点接入配置、Dashboard 管理和运行时生效语义

## 1. 阶段目标

Phase 8 把 Phase 7 的内部 capability contract 转化为用户可以理解和管理的产品配置。用户配置功能，不配置 Protocol、schema、generation 或 parser 实现细节。

本阶段只支持单部署管理员边界。配置 API 需要受部署级 admin credential 保护，但不实现组织、成员、角色或细粒度权限。

Admin credential 由部署级 secret 或环境变量 bootstrap，不通过公开 Dashboard 创建。配置 API 和公开事件接收 API 使用不同的认证边界；credential 支持轮换和撤销，不能写入浏览器 bundle、事件 payload 或普通业务日志。

## 2. PR0 — Pre-configuration Hardening

Phase 8 正式实现用户配置前，先集中处理前序 Phase review、代码审查和干净环境验证发现的、尚未由 Phase 7 PR2.1 处理的已确认问题。PR0 不重复处理 protocol namespace consolidation，不引入 capability 配置，不新增用户功能，也不改变已确认的 Page View、Visitor、Session、Dimensions 和 Dashboard 语义。

### 2.1 收集范围

PR0 只收录有证据的问题：

- 真实运行时 bug；
- CI、Docker、构建、路径和部署问题；
- 跨工作目录、干净 checkout 或不同运行环境下的失败；
- 测试覆盖不足导致的明确回归风险；
- 文档与实际行为不一致；
- 已确认的架构边界问题。

以下内容不属于 PR0：

- 新产品能力或新 capability；
- Custom Events、Web Vitals、Conversion/Funnel 等功能实现；
- 只有风格偏好的重构；
- 没有复现依据的猜测；
- Phase 8 配置模型本身的新需求。

### 2.2 Bug Register

所有候选问题必须在实现前登记，并包含 ID、Area、Severity、Evidence、Impact、Fix scope、Regression test 和 Status。Severity 使用 P0、P1、P2；Status 使用 `Open`、`Fixed`、`Verified` 或 `Deferred`。Phase 7 PR2.1 已登记的 protocol namespace、canonical path 和 fixture path 问题不再复制到本表。

PR0 本轮审查的登记项如下；后续发现的问题追加到本表。`services/processor/src/capabilities.rs` 中的 canonical capability manifest 继续使用 `include_str!` 编译期嵌入，不属于运行时路径 bug。Phase 8 的用户 capability 配置也不能替换这份静态 contract；用户配置和静态 contract 必须保持分离。

| ID      | Area                    | Severity | Evidence                                                                                                                                                                                                                                                                                         | Impact                                                                                            | Fix scope                                                                                                                                                                | Regression test                                                                                                              | Status   |
| ------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| PR0-001 | Next.js generated files | P2       | Clean checkout with Node.js 26.10.0 and pnpm 12.6.0: build rewrote Dashboard next-env.d.ts; after removing the generated files, Next Playground format check failed because it explicitly named the absent file. Next.js 16.3.6 documentation says this file is generated and should be ignored. | Normal builds polluted the Git diff; clean checkouts could not pass formatting before generation. | Ignore and untrack Dashboard and Next.js Playground next-env.d.ts; ignore it in Prettier and remove the explicit Playground format argument; keep the tsconfig includes. | Run check/build without generated files; verify Next regenerates them and Git reports no generated-file changes after build. | Verified |

后续检查发现的问题追加到同一张表，不在实现过程中隐式扩大 PR0 范围。无法在本 PR 处理的问题必须记录延期原因和后续归属。

### 2.3 PR0 执行流程

```text
代码和环境审查
  → 登记并分级问题
  → 冻结 PR0 scope
  → 修复并增加回归测试
  → 全量验证
  → 关闭或明确延期
  → 开始 Phase 8 配置实现
```

### 2.4 PR0 完成条件

- 所有 P0/P1 问题关闭；
- 影响 CI、Docker、干净环境和跨工作目录执行的问题已修复；
- 关键 P2 问题已处理，或有明确的 `Deferred` 原因和后续 PR；
- 每个修复都有对应回归测试或可重复的验证步骤；
- `pnpm check`、`pnpm test`、integration test 和相关 E2E 通过；
- 不修改既有 SQL migration；
- 不改变现有 Page View、Visitor、Session 和 Dimensions 语义；
- 不把临时修复变成新的用户配置或内部 rollout flag；
- 架构边界发生变化时新增 ADR。

#### 2026-09-24 PR0 closure record

- 已审查 CI 与 workspace 命令、Docker/Compose 构建及服务边界、文档和静态 capability manifest；除 PR0-001 外，未发现有证据的 P0/P1/P2 问题。
- 在 commit 2341a2f 的隔离 checkout 中，使用 Node.js 26.10.0 和 pnpm 12.6.0 验证 frozen install、pnpm check 和 pnpm build。初次 build 复现 PR0-001；修复后在生成文件缺席时 check 和 build 均通过，Next.js 成功重建文件，Git 未报告生成文件变化。frozen install 未修改 package.json 或 pnpm-lock.yaml。
- 当前代码基线此前已通过 PostgreSQL migration/integration 及 Analytics、Dashboard、Router Adapter E2E。PR0 只调整生成文件跟踪和格式检查输入，不影响运行时路径，因此复用这些验证结果。
- P0/P1：无；P2：PR0-001 已验证修复。PR0 关闭，可以开始 PR1。

### 2.5 PR0.5 — Dependencies and Build Tool Refresh

在配置模型和 migration 开始前，升级项目依赖与构建工具。项目以自身构建、测试和部署兼容为目标，不需要为外部消费者维持库的 semver 范围；允许 major 更新，但不得把升级和 capability 配置功能混在同一个 PR。执行日基线见仓库升级记录；具体执行分组如下：

1. **PR0.5a — pnpm 与 Node.js 基线：** 固定 pnpm 12.6.0、Node.js 26.10.0，同步 `packageManager`、engines、`.node-version`、CI、开发文档和 Node Docker 镜像。
2. **PR0.5b — JavaScript 开发与测试工具：** 升级 TypeScript、ESLint、Prettier、Vitest、Playwright 和相关插件，处理配置/API 迁移。若当前插件不支持最新主版本，记录 Deferred 与重试条件，不通过跳过 lint/typecheck 验收。
3. **PR0.5c — 浏览器与应用依赖：** 升级 Next.js/React、Vite、React Router、TanStack Router、`web-vitals` 及 workspace 直接运行依赖；按集成边界拆分并同步 peer ranges。
4. **PR0.5d — Rust 工具链与 crates：** 升级 Rust stable、workspace crates 和 `Cargo.lock`，本地与 Rust Docker 镜像一致，并处理 crate API breaking changes。
5. **PR0.5e — CI 与基础设施镜像：** 升级 GitHub Actions、PostgreSQL 和其他构建期系统依赖。Node 镜像由 PR0.5a 固定，Rust 镜像由 PR0.5d 对齐。

每批 PR 都必须：

- 记录升级前后版本、官方发布来源、breaking changes 和兼容性决定；只使用正式稳定版，不使用 prerelease 或 `latest` 浮动标签。
- 保持锁定版本和声明范围一致。执行 `pnpm install --frozen-lockfile` 不得自动改写 `packageManager` 或 lockfile；Node、pnpm、Rust 和容器版本要在本地、CI、Docker 中对齐。
- 更新后运行对应 package 的 check/test/build；跨边界升级还要运行 migration、Rust integration、Analytics E2E、Dashboard E2E、Router Adapter E2E 和 Compose profile 验证。
- 将不可升级项连同阻塞原因、复现证据和重试条件记录为 Deferred，不为了追求版本号而降低测试或安全边界。

#### 2026-09-24 执行记录

- 已设置 Node.js 26.10.0、pnpm 12.6.0、Rust 1.98.1；PostgreSQL 镜像为 18.6-alpine3.23。Node、Rust、PostgreSQL 与 GitHub Actions 均使用固定版本/发行标签。PostgreSQL 18 更改了数据目录布局，Compose 改用 `/var/lib/postgresql` 并使用新的 `postgres_data_v18` volume；旧 volume 保留，升级数据需要按 Getting Started 的备份/恢复步骤迁移。
- JavaScript workspace 使用 Next.js 16.3.6、React 19.3.0、Vite 8.3.0、Vitest 5.0.1、Prettier 3.9.9、Playwright 1.63.0。Next ESLint 配置迁移到 flat config；Dashboard 测试显式启用 React Vite plugin。
- Rust workspace crates 和 lockfile 已升级；SQLx 0.9 的动态 SQL 安全标记及 Migrator 初始化、jsonschema 0.57 API 变更已迁移。
- **Deferred：TypeScript 7.0.2。** 当前 `typescript-eslint` 8.70.1 声明支持 TypeScript `<6.1.0`；升级 TS7 会越过 parser 支持范围，因此 workspace 暂用 TypeScript 6.0.3。待 typescript-eslint 官方支持 TS7 后重试，并运行完整 typecheck/build。
- **Deferred：ESLint 10.11.0。** 当前 Next.js/React lint 依赖在 ESLint 10 Rule API 上失败（`eslint-plugin-react@7.37.5` 调用已移除的 `context.getFilename`；后续 scope manager API 也不兼容）。workspace 暂用 ESLint/@eslint/js 9.39.5，配合 Next.js flat config；待 Next/React 插件兼容 ESLint 10 后升级，并运行完整 lint/check。
- `pnpm outdated -r` 仅列出上述 TypeScript、ESLint 和 `@eslint/js` 三项；其余 workspace 声明依赖无更新项。`pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test` 和 `pnpm build` 已通过。PostgreSQL 18 migration 与 integration tests 已通过；Analytics E2E 10 个 fixture、Dashboard E2E 全部场景、Router Adapter E2E 三种路由器均通过。所有 Compose profiles 配置校验通过；Dashboard E2E 已从空的容器依赖卷完成 frozen install、镜像构建和完整浏览器流程。首次 Dashboard E2E 重跑因并行集成测试数据库占用默认端口 `15432` 未启动；清理临时数据库后重跑通过。检查期间格式校验发现 Next.js 自动生成的两个 `tsconfig.json` 排版变化，已格式化并由最终 `pnpm check` 复核。

依赖升级实现和主要验证已完成。干净 checkout 的 frozen install、check 和 build 已使用固定的 Node.js 26.10.0 / pnpm 12.6.0 验证通过；该项只验证锁定工具链，不替代 Release Readiness 的完整 E2E。升级中发现的具体 bug 按 PR0 bug register 规则登记，但不因此把用户配置功能混入升级 PR。

### 2.6 Phase 8 顺序执行计划

以下工作按顺序执行；每个 PR 合并并通过本 PR 验收后，才开始下一项。所有 PR 都需包含其边界内的测试与文档，不把失败策略、数据语义或权限决定留给 Dashboard 实现阶段。

| 顺序 | PR                                                 | 范围与出口条件                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | **PR0 — Pre-configuration Hardening**              | 对照 §2.2 bug register 完成前序问题审查。本轮已登记的 PR0-001（P2）已修复并验证；closure record 见 §2.4。后续候选项按 §2.2 登记，并确认 P0/P1 关闭或明确阻塞。不得顺手加入配置功能。                                                                                                                                                                                                             |
| 0.5  | **PR0.5a–e — Dependencies and Build Tool Refresh** | 实施和干净 checkout 出口验收已完成，版本与结果见 §2.5。TypeScript 7 与 ESLint 10 延期不阻止进入配置工作，按记录的重试条件跟进。                                                                                                                                                                                                                                                                  |
| 1    | **PR1 — Configuration Semantics and Contracts**    | 新增 ADR 与可校验的配置/API contract。冻结配置主体及 site/environment 关系、旧 `analytics_enabled` 到 capability 默认值的映射、依赖与默认值、关闭后历史查询/重新开启/backfill、并发版本、服务不可用行为、Origin/identity 约束、consent 语义、部署级 admin credential 的 bootstrap 与 Dashboard 调用边界、Ingest Key 轮换/撤销/返回语义，以及配置审计和敏感字段规则。没有数据库 migration 或 UI。 |
| 2    | **PR2 — Configuration Persistence and Migration**  | 按 PR1 冻结的 contract 实现配置表、约束、版本与 additive migration；为已有站点建立确定性默认配置并映射 `analytics_enabled`。旧字段在兼容窗口内保留，迁移重复执行、失败恢复和回滚路径均有测试；本 PR 不切换 Collector/Processor 的运行时读取。                                                                                                                                                    |
| 3    | **PR3 — Protected Configuration API**              | 实现部署级管理员授权、配置读取/更新、依赖与 settings 校验、版本冲突、审计。API 仅调用配置存储边界，不向浏览器暴露部署级 admin credential；测试覆盖未授权、无效输入、冲突、审计脱敏和持久化读回。                                                                                                                                                                                                 |
| 4    | **PR4 — Collector Ingest Policy Runtime**          | 将站点启用状态、Origin allowlist 和 Ingest Key 策略接入 Collector；实现 PR1 规定的刷新、最后有效配置/拒绝策略、轮换重叠窗口与故障行为。验证启动、配置刷新、Collector 重启、密钥轮换/撤销和已有 TOML 配置迁移边界。                                                                                                                                                                               |
| 5    | **PR5 — Capability Runtime**                       | 让 Collector、Processor 与 Analytics API 按同一份版本化配置处理 capability 开关；运行时不再读取 `analytics_enabled`。关闭时停止相应的新事件接收、事实生成或报告；历史数据按 PR1 规则保留/查询，重新开启不自动 backfill，显式 rebuild 按当前配置执行。三个服务按站点上报版本并参与收敛状态聚合。                                                                                                  |
| 6    | **PR6 — Dashboard Core Configuration**             | 在服务端配置 API 可用后实现 capability 与 consent 状态、environment ingestion 启停、Origin 管理、Ingest Key 创建/轮换/撤销和最后生效状态。覆盖读取、保存、校验错误、版本冲突、加载/空/错误状态；部署级 admin credential 不进入浏览器 bundle，Ingest Key 明文只按 PR1 规则返回。                                                                                                                  |
| 7    | **PR7 — Conversion/Funnel Definition Management**  | 独立实现定义的创建/编辑/停用、版本化、校验与 Dashboard 管理。冻结定义变化对已生成 facts、历史查询和 backfill 的影响；避免将业务定义 CRUD 与基础 capability 开关耦合。                                                                                                                                                                                                                            |
| 8    | **PR8 — Configuration End-to-end Acceptance**      | 完成配置变更后的端到端 workflow：受保护写入 → 存储/版本递增 → Collector 与 Processor/API 生效 → Dashboard 展示；覆盖刷新、服务故障、回滚、历史边界和站点隔离。同步更新 Getting Started、运维/备份/恢复说明和 Phase 8 验收记录。Firefox/WebKit 完整浏览器矩阵延期至 MVP 之后；retention、生产恢复演练、country Geo staging 与 SDK 独立发布验证列为产品实际运行后的工作。                          |

PR1 是模型与 migration 的硬性前置，语义见 ADR-012 和 configuration contract。PR2 先保留兼容路径，直到 PR4/PR5 的运行时切换和回滚验证完成；PR6 依赖 PR3–PR5 已提供且已验证的生效语义；PR7 可在 PR6 后独立实现，并按 PR1 冻结的定义版本与历史重算规则执行。PR8 只做跨层验收与部署文档，不承接未拆分的产品功能。

### 2.7 PR1：冻结的配置 Contract

PR1 的静态 schemas、OpenAPI 和 fixtures 位于 `protocol/contracts/configuration/current/`；此处仅定义接口和语义，不实现持久化或运行时切换。

- Site capability configuration 包含 manifest 中全部十项 implemented capability；每项只能有 `enabled` 和空 `settings`。未知字段/ID、关闭 Page Views、未满足依赖均拒绝。Consent 固定为 `required`，隐私约束固定包含不持久化 IP、不使用 fingerprinting 和必须取得 consent。
- 新配置默认保留当前行为：Page Views 和其余 capability 默认开启。旧 `analytics_enabled=true` 将 Browser Context、Anonymous Visitors、Sessions、Dimensions 迁移为开启；false 或无旧记录则迁移为关闭；其余 capability 开启。PR2 执行映射，旧列在 PR5 运行时切换和回滚验证后再退役。
- Environment policy 独立版本化，包含 enabled、Origin allowlist、active key metadata 和每分钟限流（默认 600）。Environment 是非空标识，不设默认值；同一 site + environment 唯一，同一 site 的不同 environment 不得共用 Origin。
- 所有变更使用带引号的当前版本 ETag（`If-Match`）；版本冲突返回 409 `configuration_version_conflict`，不应用部分变更。校验失败返回 422，缺少 Admin 凭据返回 401，配置存储不可用返回 503。
- Admin API 使用独立 `Authorization: Bearer`。部署通过 `CONFIG_ADMIN_TOKENS` 的 JSON array 提供一至两把唯一的 32-byte CSPRNG Base64URL 凭据以支持重叠轮换；移除旧值并 reload secret 即撤销，凭据以 constant-time 比较。Dashboard 只由服务端 BFF 调用 Admin API，浏览器 bundle 不含该 credential。
- Ingest Key 使用 32-byte CSPRNG Base64URL key，服务端只保存 SHA-256 digest；创建响应是唯一一次返回明文的时机。轮换通过创建新 key 并在确认客户端切换后撤销旧 key；Collector 在下一次成功刷新后（正常不超过 5 秒）执行撤销。digest、明文和 Admin token 不进入日志或审计。
- 每次配置变更记录 deployment-admin、对象、时间、版本及变更字段名；审计 schema 不接收变更值、凭据、Ingest Key 或其 digest，保留一年。
- capability 和 environment policy 刷新间隔为 5 秒。运行中的服务在存储故障期间保留最后有效配置并标 stale；无启动快照时除健康检查外 fail closed。生效状态列出各相关服务的 applied version，全部追上 stored version 后才为 current。

#### 2026-09-24 PR1 contract completion record

- ADR-012、Site capability/Environment policy/Audit JSON Schemas、PUT request schemas、Admin API OpenAPI 和 valid/invalid fixtures 已冻结；Protocol validator 已纳入 contract 校验。
- Legacy flag true/false/missing、依赖、consent、Page View baseline、Origin/environment 隔离、版本冲突、密钥一次性返回和审计脱敏均有自动校验。
- 本 PR 未新增 SQL migration，也未修改服务运行时或 Event Protocol。PR1 contract 出口完成，可以开始 PR2。

#### PR2 执行记录（2026-09-25）

- 新增 `20260925001300_create_configuration_storage.sql`：版本化 capability 与 environment policy JSONB 文档、schema 形状校验函数、同一站点的 Origin 跨 environment 唯一约束、受限字段的配置审计表及一年到期索引；environment 标识不另设 contract 未声明的长度上限。
- Capability 文档仅从 `analytics_feature_flags` 现有行初始化；Page Views 与独立 capability 默认开启，四项旧分析 capability 依 `analytics_enabled` 映射。旧列保留；environment policy 不从 Collector TOML 导入。
- 迁移回归覆盖 clean install、重复运行、完整 true/false capability 映射、拒绝非法 JSONB 文档、时间戳一致性、Origin 规范化冲突、长 environment 标识、审计唯一字段与到期清理、失败时 DDL 原子回滚后重试，以及旧列保留。`pnpm test:migrations` 已通过。
- 站点若没有 `analytics_feature_flags` 行，不会由本迁移创建 capability 文档；本阶段不扫描 `raw_events` 推断站点。

#### PR3 执行记录（2026-09-25）

- Analytics API 增加独立 Bearer 认证的 admin router；`CONFIG_ADMIN_TOKENS` 缺失或为空时仅管理路由返回 401，配置格式错误时拒绝启动。token 不写日志；校验采用 constant-time 比较。
- Capability 与 environment policy 支持读取/更新；policy 新建使用 `POST` 和 `If-None-Match: *`，版本更新、Key 创建与撤销使用 `If-Match`。空 Key policy 可先创建且维持 fail-closed，后续首个 Key 在事务中写入。
- 配置、版本和脱敏审计通过同一 PostgreSQL 事务提交；Ingest Key 使用 OS CSPRNG 生成，仅存储 SHA-256 digest，明文仅在创建响应返回。运行时应用状态暂报 `pending`，各服务 applied version 为 null，待 PR4/PR5 接入上报。
- 新增 additive migration `20260925001400_allow_empty_ingest_key_policies.sql`，未修改 PR2 migration。Protocol contract、token 单测、API/PostgreSQL 集成及 migration 回归通过；公开查询 API 无需 Admin token。

#### PR4 执行记录（2026-09-25）

- Collector 每 5 秒从 PostgreSQL 加载并校验 environment policy，构建不可变快照后原子替换；DB policy 覆盖同身份 TOML 配置，成功查询确认缺失时才回退 TOML。冷启动无有效快照、无配置、禁用策略和空 Key policy 均 fail closed；数据库刷新失败保留最后有效策略。
- Ingest Key 仅以 SHA-256 digest 比较，常量时间匹配；TOML 明文 Key 在建 registry 时转 digest，安全日志不再输出 Key 摘要/指纹。限流使用 policy 的 `rate_limit_per_minute`。
- 新增 `20260925001500_create_configuration_runtime_state.sql`，分别存储 Collector 实例心跳和每实例的环境策略版本。API 汇总 15 秒内活跃实例；活跃实例尚无该 policy 的报告时保持 `pending`，所有实例达到存储版本才是 `current`，刷新失败或只有过期报告时为 `stale`；无策略历史时 applied version 为 null。Collector 每 5 秒启动首轮并轮询，旧状态按日清理。
- 本 PR 未修改 PR2/PR3 migration，也未导入 TOML；Capability 运行时仍留给 PR5。Collector 单测和 API PostgreSQL 集成覆盖策略解析、空 Key、身份校验、多实例版本聚合、stale 和心跳过期。

## 3. 配置模型

建议的逻辑模型：

```text
site
  id
  name

site_capabilities
  site_id
  capabilities
  consent_policy
  privacy_constraints
  updated_at
  version

site_environment_ingest_policies
  site_id
  environment
  enabled
  allowed_origins
  ingest_key_digests
  rate_limit_per_minute
  updated_at
  version

configuration_audit
  actor_kind
  resource
  version
  redacted_change_summary
  created_at
  expires_at
```

上述字段是 PR1 的逻辑 contract；PR2 再设计具体 PostgreSQL 字段、索引、约束和 additive migration。审计保留期为一年。

## 4. 配置边界

### 用户可以配置

- Page Views、Browser Context、Visitors、Sessions、Dimensions、Custom Events、Web Vitals、Conversions、Funnels 和 Geo country 的启用状态；当前配置 contract 暂不接受 capability-specific settings；
- Conversion 和 Funnel 定义；这些定义依赖 Phase 7 已冻结的事件 contract，但由 Phase 8 提供用户管理入口；
- Geo country 的启用状态；region/city 不属于当前 MVP，精度级别配置留待后续 Geo 扩展单独设计；
- Origin allowlist；
- Ingest Key 的创建、轮换和撤销；
- consent 与隐私策略说明。Consent 是强制边界，站点不能关闭或绕过。

### 用户不能配置

- Protocol 版本；
- schema version；
- Processor generation；
- parser version；
- 内部 rollout flag；
- 数据库表名和 migration 版本；
- SDK 内部 buffer 或 retry 实现。

## 5. 依赖和保存校验

配置 API 保存时必须拒绝：

- 未知 capability；
- 非法 settings；
- 缺少依赖的 capability；
- 不兼容的 Origin、environment 和 identity 配置；
- 空的或重复的 Origin；
- 不符合策略的隐私设置；
- 缺少部署级 admin credential 的修改请求。

依赖示例：

```text
sessions       → anonymous_visitors
dimensions     → browser_context
conversions    → custom_events
funnels        → conversions / custom_events
```

## 6. 配置 API

受保护的 configuration namespace 必须提供下列 contract；API 使用独立 deployment-admin Bearer credential，与公开 Ingest API 隔离：

- 查询站点和 capability 状态；
- 更新 capability；
- 查询和更新 ingest policy；
- 创建、轮换和撤销 Ingest Key；
- 创建和修改 Conversion/Funnel 定义；
- 返回校验错误、版本冲突和生效状态；
- 配置审计记录。

Dashboard 只通过服务端 BFF 调用配置 API，不直接访问 PostgreSQL，也不接触 Admin credential。部署反向代理必须保护 Dashboard 管理入口和配置 API。

## 7. 生效语义

生效边界、版本冲突、刷新间隔、配置源故障、历史查询/backfill、定义 revision 和 Geo dataset 版本均由 PR1 的 [ADR-012](../../decisions/ADR-012-phase-8-configuration-contract.md) 冻结。后续实现必须遵循该决策；例外需先更新 ADR 和相应 contract fixtures。

## 8. Dashboard

Dashboard 至少提供：

- capability 状态总览；
- 依赖和校验提示；
- 保存、冲突和失败状态；
- 配置生效状态和最后更新时间；
- Origin 和 Ingest Key 管理；
- Conversion/Funnel 定义管理；
- consent 和隐私说明。

Dashboard 不展示 Protocol 版本、schema、generation 或 parser rollout 信息。

## 9. 测试计划

- 配置 JSON Schema、OpenAPI contract 和 fixtures；migration 在 PR2 验收；
- admin credential 和未授权请求；
- 未知 capability、非法 settings 和依赖错误；
- capability enable/disable；
- 配置版本冲突；
- Collector、Processor、API 读取配置；
- 配置服务不可用时的 fallback；
- Origin 和 Ingest Key 轮换；
- Dashboard 保存、刷新和错误状态；
- 配置变更后的完整 E2E；
- 历史数据可查询和 backfill 边界。

## 10. Phase 8 退出条件

- 配置模型和 migration 已冻结；
- capability、ingest policy、consent 和 authorization 边界清晰；
- authorization 限定为单部署管理员，不引入组织或角色模型；
- 配置 API 和 Dashboard 已完成；
- Collector、Processor 和 Analytics API 使用同一份配置语义；
- 配置失败、回滚、旧配置和历史数据行为有测试；
- 用户无需理解内部协议版本或处理器实现细节；
- 完成至少一条配置变更后的端到端 workflow。

#### PR5 执行记录（2026-09-25）

- 新增共享 `configuration-runtime` crate：每 5 秒加载、校验 capability JSONB，按 site 构建快照并原子替换；启动时无有效配置 fail closed，刷新故障保留最近有效快照并上报 stale。没有 capability 文档时不回退到旧 `analytics_enabled`。
- Collector 按 capability 拒绝关闭的独立事件类型；Page Views 保持基线，按开关裁剪 Browser Context 和 visitor ID，并按 capability 跳过 Geo enrichment。
- Processor 仅对当前启用的能力生成新 facts；显式 rebuild 按执行时能力控制生成范围，关闭时保留已存在 facts，重新开启不自动补算已停用期间的数据。`analytics_enabled` 不再用于 Processor 运行时决策。
- Analytics API 使用共享快照门控 capability 管理的报告，并保留 PR1 允许的历史查询语义；overview/Page Views 保持基线。
- 新增 `20260925001600_add_capability_runtime_state.sql`，按 service/instance/site 存储 applied version、刷新状态和心跳；API 对 15 秒内活跃实例按服务汇总最低版本，stale 优先于 pending，旧实例按日清理。新增启用时间窗口，避免关闭期间的历史事件在重新启用后被增量路径补生成事实。
- `analytics_feature_flags.analytics_enabled` 及 PR2 映射保留供部署回滚；Collector environment policy 继续使用 PR4 独立状态表和刷新语义。

#### PR6 执行记录（2026-09-27）

- Dashboard 设置页加入 environment ingestion 启停控件；创建和更新 policy 均提交 `enabled`，更新继续使用当前版本 `If-Match`。保存后同步服务端返回的状态并显示启用/停用结果和运行时生效版本。
- 保留 capability 依赖、必需 consent、隐私说明、Origin/限流和 Key 管理边界；Admin token 仍只由服务端 loader/BFF 使用。
- Dashboard E2E 覆盖依赖拒绝、Origin 校验错误、policy 创建/停用/恢复与刷新、409 冲突和重载、Key 复制/隐藏/一次性显示/轮换/撤销。Conversion/Funnel 编辑器保持原样，属于 PR7 管理范围。
- `pnpm --filter @web-analytics/dashboard test`（104 tests）、`pnpm check` 和 `pnpm e2e:dashboard` 均通过。PR6 完成，下一步 PR7。

#### PR7 执行记录（2026-09-27）

- 完善现有 Dashboard 定义编辑器：保留 Conversion/Funnel 创建、编辑和停用流程；保存期间锁定定义表单，避免在请求期间修改草稿。
- 对 409 版本冲突显示服务端错误和“Reload latest definitions”操作；存在未保存改动时确认后才经 BFF 读取并应用服务器最新版，取消则保留草稿。服务端校验错误继续展示在编辑器中。
- Dashboard E2E 覆盖非法定义拒绝、保存期间控件锁定、Conversion/Funnel 创建与刷新持久化、新 revision 保存、并发更新冲突与草稿确认/保留、停用和历史事实保留；定义变更不触发自动 backfill，显式历史 Conversion/Funnel 版本查询均返回原结果。
- 验收结果：`pnpm --filter @web-analytics/dashboard test`（108 tests；包含保存锁定、服务端校验错误和冲突恢复组件交互测试）、Dashboard lint/typecheck、`pnpm e2e:dashboard`、`pnpm check` 和 `pnpm build` 均通过。
- 不新增 API、schema 或 migration，不提供旧版恢复功能。PR8 的跨层验收和部署文档完成情况见下方 PR8 执行记录。

#### PR8 执行记录（2026-09-27）

- 新增独立 `pnpm e2e:configuration` 和 CI job，使用独立 Compose 项目/数据卷，通过 SQL fixture 预置 site capability，再通过受保护配置 API 更新 capability；environment ingest policy 则通过受保护 API 创建并更新。
- 验收覆盖版本递增与冲突、Collector/Processor/Analytics API 运行版本收敛、Collector 停用拒绝写入和恢复、配置补偿性回滚、跨站点事件隔离、Geo 停用期间不生成新 facts、重新启用不自动 backfill、历史 Page View 查询，以及 Dashboard 显示 current 状态和 capability/ingest policy 版本。存储中断时验证 Collector 保持健康并记录保留最后有效策略；Processor 与 Analytics API 在故障前已应用目标版本，存储恢复后重新收敛。共享 configuration-runtime 单元测试模拟数据库不可达，并验证 Processor 与 Analytics API 保留最后有效快照且将站点标记为 stale。
- Conversion/Funnel revision、历史事实保留和不自动 backfill 由现有 Dashboard E2E 覆盖；PR8 不增加 API、schema 或 migration。
- `pnpm e2e:configuration`、`pnpm check`、`pnpm test`、`pnpm test:migrations`、`pnpm test:integration`、`pnpm e2e:analytics`、`pnpm e2e:dashboard` 和 `pnpm build` 均通过。迁移和集成测试使用隔离 PostgreSQL Compose 数据库；主机缺少 `psql` 时由 `/tmp` 临时转发器调用容器内客户端。Phase 8 退出条件满足，可进入 MVP Release Readiness。
