# Analytics 与 Site Management 模块边界设计

- Status: Proposed
- Scope: Backend business modules, API ownership, database table ownership, Dashboard API clients
- Overall sequence and gates: [Platform Improvement Roadmap](platform-improvement-roadmap.md)
- Related: [Site Onboarding and Settings Design](site-onboarding-settings-design.md), [Protocol Schema and Static Runtime Models](protocol-static-runtime-design.md), [Dashboard UI Improvements](dashboard-ui-improvements.md)

## 背景

当前 Dashboard 同时提供两类能力：查询观测数据，以及管理 Site 的运行配置。前端已经有 Analytics API client 和 Configuration API helper 的代码区分，但两类调用使用同一个 `ANALYTICS_API_URL`。后端则在同一个 `analytics-api` Axum router 中注册 analytics report 和 admin configuration 路由，并共享 `AppState` 与 PostgreSQL pool。

本设计不要求将两类能力立即拆为独立进程、容器或数据库。要求先在代码的 Rust `mod` 层面建立清楚、可检查的业务边界，使两边可以独立演进，并限制它们之间必要的数据交集。

当前还有一个相关产品缺口：Dashboard 的站点列表来自 `DASHBOARD_SITES` 环境变量；配置 API 能修改已存在的站点配置，但没有完整的站点目录和原子化创建流程。站点目录和 onboarding 归 Site Management 领域，具体用户流程见 [Site Onboarding and Settings Design](site-onboarding-settings-design.md)。

## 目标

1. Analytics 和 Site Management 在 Rust 模块结构中拥有各自的 routes、handlers、services、repositories、models 和错误映射。
2. 顶层应用只负责组装模块 router 和基础设施依赖，不包含跨领域业务逻辑。
3. 共用 PostgreSQL 实例和连接池时，仍清楚标记数据表的读写 owner。
4. Site Management 与 Analytics 不共享领域模型，不直接调用对方的 handler、service 或 repository。
5. 两边只通过明确、最小的接口或只读模型交互。
6. Dashboard 对两个领域使用分开的 API client 和 URL 配置；初期 URL 可以指向同一 origin。
7. 保持现有 API 路径和行为，按阶段迁移，不要求一次完成服务拆分。

## 非目标

- 本设计不要求立即引入独立 Site Management 微服务或单独部署。
- 不要求立即拆分 PostgreSQL 实例、连接池或数据库 schema。
- 不在本设计内决定多租户 RBAC、团队管理或身份认证产品方案。
- 不把 Analytics 的 conversion/funnel 报表移入 Site Management；报表数据仍属于 Analytics。
- 不允许 Dashboard 绕过后端领域 API 直接访问数据库。

## 领域职责

### Analytics

Analytics 拥有围绕观测数据的查询与报告能力，包括：

- Overview、timeline、pages、events、dimensions、visitors、sessions、geo 和 Web Vitals 报表。
- Conversion 与 funnel 的计算结果和报表查询。
- 分析数据查询参数、响应模型、查询语义和分析错误类型。

Analytics 可读取生成报告所必需的已发布配置或定义快照，但不创建、修改或撤销 Site 配置。

### Site Management

Site Management 负责站点生命周期和运行时配置的常规管理：

- Site registry：站点 ID、显示名称、网站 URL、状态和生命周期。
- Capabilities 及其版本、activation windows。
- Environment、Allowed Origins、限流策略和 ingestion 开关。
- Ingest Key 的创建、摘要存储、轮换与撤销。
- Conversion/funnel definitions 的创建、版本化、更新和停用。
- 配置审计与配置应用状态的管理接口。

当前 Processor 的显式 `--import-definitions-if-empty` 可写入 definition revisions；迁移核对后，它只作为历史导入工具，常规新增和修改由 Site Management 负责。站点创建向导属于 Site Management。若创建过程要初始化多项记录，应由管理领域服务负责事务协调，不能由 Dashboard 直接串联多个写 API 来模拟原子创建。

### Conversion/Funnel 交界

Conversion/funnel 有定义和分析结果两部分，按职责归属不同领域：

- 定义及其版本属于 Site Management。
- 根据定义计算出的事件计数、转化 session 和 funnel 报表属于 Analytics。
- Analytics 读取定义时，使用清楚声明的只读版本化输入；不能通过管理模块的 repository 读取或写入配置表。
- 查询必须明确使用的 definition revision/version，避免配置更新改变历史报告的解释。

## 目标代码结构

初期可以继续保留 `services/analytics-api` 作为单个 Rust crate 和可执行服务，内部结构调整为：

```text
services/analytics-api/src/
  analytics/
    mod.rs
    routes.rs
    handlers/
    service/
    repository/
    models.rs
    errors.rs

  site_management/
    mod.rs
    routes.rs
    handlers/
    service/
    repository/
    models.rs
    errors.rs

  app.rs                 # 组装各业务 router
  state.rs               # 共享基础设施与各领域 state 的构造
  main.rs
```

文件和子目录可以按当前代码规模调整，不要求机械地为每一层创建空目录。关键要求是 `analytics` 与 `site_management` 作为明确 Rust module 存在，领域实现放在各自 module 下。跨进程使用的运行配置模型继续属于 `crates/configuration-runtime` 共享 crate；`analytics-api` 的 Analytics module 只保留消费该模型的最小只读 adapter，不再在服务目录下复制一份共享 runtime module。

顶层 router 只做组合，例如：

```rust
Router::new()
    .merge(analytics::routes(state.analytics.clone()))
    .merge(site_management::routes(state.site_management.clone()))
    .route("/health", get(health))
```

具体 router API 以实际 Axum 版本为准。顶层组合器不执行业务校验、不访问业务表、不把某领域的 DTO 转换为另一领域的 DTO。

## 模块依赖规则

### 允许的依赖

- 两个领域可使用通用基础设施：数据库连接池、时间、日志、随机数、通用 HTTP 类型等。
- 顶层应用可依赖两个 module 的公开 router/state constructor。
- Analytics 可通过显式只读 adapter 获取版本化 conversion/funnel 定义或必要的 capability 查询状态。
- Collector、Processor 和 Analytics 可消费 `runtime_configuration` 明确暴露的最小运行配置模型或读取接口。
- Site Management 可以读取来自运行时实例的配置应用状态，以向管理员展示 pending/current/stale；该状态读取应通过明确接口或专用 repository，不共享 Analytics 领域对象。

### 禁止的依赖

- `analytics` 不调用 `site_management::handlers`、`service` 或内部 `repository`。
- `site_management` 不调用 Analytics 查询 handler/service，不写分析事实表或聚合表。
- 一方不导入另一方内部 DTO、错误类型、SQL row model 或领域 enum。
- 业务 module 不引用顶层 router 以形成循环依赖。
- Dashboard 不直接依赖 Rust 内部模型或数据库表结构。
- 不建立含有两领域所有类型的通用 `models`、`shared` 或 `common` module。

跨领域所需数据应通过小型、只读、版本明确的 contract 表达。若某类型只被一方消费，则留在该方；不要仅因为它在同一个 JSON 文档里就将完整管理文档变成共享领域模型。

## State 与基础设施

可以继续共享同一个 `PgPool`、配置加载器、运行时指标与 tracing subscriber。共享连接池属于基础设施共享，不代表共享领域 state。

建议由顶层 state 构造器分别创建领域 state：

```text
ApplicationState
  ├── AnalyticsState
  │     ├── analytics repositories
  │     └── read-only definition/capability adapter (only if needed)
  └── SiteManagementState
        ├── site/configuration repositories
        └── admin authorization and audit services
```

领域 state 仅暴露自身所需依赖。不要继续让每个 handler 都拿到包含所有配置、管理凭据、analytics 查询服务和整个 AppState 的万能状态对象。

## 数据库 ownership

同一 PostgreSQL 实例内按写入职责区分业务数据与运行状态。M0 盘点所有相关表及隐式写入入口；下表列出已知的当前写入者、目标 owner 和跨域访问方式。Migration、显式旧数据导入与一次性 seed 必须单独标注来源，不能被误认为常规业务写入。

| 数据类别                                            | 当前写入者                                          | 目标常规写入 owner                     | 跨域读取与迁移                                                              |
| --------------------------------------------------- | --------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Site Registry                                       | 尚未建立                                            | Site Management                        | 旧 Site ID 从配置与历史事实回填；Analytics 只读取必要身份                   |
| Capabilities / activation windows                   | 管理 API、开发 seed                                 | Site Management                        | Collector、Processor、Analytics 读取最小运行快照                            |
| Environment policy / Origins / key metadata         | 管理 API、开发 seed；Collector TOML 可提供 fallback | Site Management                        | Collector 读取 DB 策略；M4 收敛 TOML 旧入口                                 |
| Definition revisions                                | 管理 API、Processor 显式文件导入                    | Site Management                        | Processor/Analytics 按版本只读；显式文件导入仅作旧数据迁移                  |
| Configuration audit                                 | 管理 API、Processor 显式定义导入                    | Site Management                        | 显式迁移保留来源和 actor；Analytics 不写管理审计                            |
| Collector policy applied state / instance heartbeat | Collector                                           | Collector                              | Site Management 只读展示配置应用状态                                        |
| Capability applied state / instance heartbeat       | 各服务通过 `configuration-runtime` 写入             | 各运行服务                             | Site Management 只读展示配置应用状态；共享 crate 是写入机制，不是业务 owner |
| Raw events                                          | Collector 插入；Processor 更新处理标记              | Collector 插入；Processor 更新处理标记 | Analytics 可查询，Site Management 不写                                      |
| Processed facts / aggregates                        | Processor                                           | Processor                              | Analytics 只读查询，Site Management 不写                                    |

当前运行状态表包括 Collector 使用的 `configuration_runtime_state` / `configuration_runtime_instances`，以及共享 crate 使用的 `configuration_capability_runtime_state` / `configuration_capability_runtime_instances`。这些表反映各进程自己的应用状态，不属于 Site Management 可编辑配置。

Migration 文件可因外键或创建顺序涉及多张表；领域 repository 的 SQL 读写边界仍须明确。首轮不要求改表名、PostgreSQL schema 或数据库实例。

## API 与 Dashboard 边界

现有 `/v1/sites/...` analytics 路径和 `/v1/admin/sites/...` 管理路径可以暂时继续由同一个 HTTP listener 提供。路径 namespace 有助于区分 API 使用方式，但不替代 Rust module 边界。当前 `/v1/sites/{site_id}/definition-revisions` 虽在配置 handler 文件中，却是 Analytics 页面使用的公开只读查询；M1 应明确其路由 owner，并通过 Site Management 定义快照的只读 adapter 保持现有 HTTP 行为。

Dashboard 应分别拥有：

- Analytics API client、response types、query/report helpers。
- Site Management API client、configuration types、site onboarding/settings helpers。

即使迁移初期都指向同一服务地址，也应分别通过例如 `ANALYTICS_API_URL` 和 `SITE_MANAGEMENT_API_URL` 配置。可在部署配置中令两个值相同；客户端代码不应因为共用 origin 而耦合在一起。管理 token 只由 Dashboard server-side management client 使用，不进入 Analytics client 或浏览器 bundle。

Site Management API 后续应提供动态站点目录和创建能力，取代 `DASHBOARD_SITES` 作为运行时站点事实来源。环境变量可以保留用于默认选择或部署配置，但不能限制数据库里可管理的站点集合。

## 渐进迁移计划

总规划的 M0–M9 决定跨文档先后关系。本节阶段 0–2 对应先建立业务 module 和只读 adapter；阶段 3–4 只有在 Site Registry migration、数据库配置权威切换和管理 API 完成后才进入 Dashboard。模块搬迁时保持现有路径与行为，不把新业务功能混入同一切片。

### 阶段 0：确认 contract 与 ownership

- 确认 Site、Environment、Capability、Origin、Ingest Key 与 conversion/funnel definition 的领域归属。
- 为现有数据库表记录 owner、允许的读者和唯一写者。
- 明确 analytics 报表读取 definition 的 revision/version 语义。
- 冻结现有 API 的路径、请求/响应、鉴权、ETag 和错误兼容要求。
- 将本设计与站点 onboarding 设计合并检查，确保 Site registry/create API 的职责归 Site Management。

### 阶段 1：同一 crate 内建立 `mod` 边界

- 创建 `analytics` 和 `site_management` module，将现有路由分别移入。
- 将 handler、业务 service、repository、领域 DTO 和错误定义移至 owner module。
- 顶层 router 只 merge 子路由，保持现有 URL 和行为不变。
- 拆分当前万能 `AppState` 为领域 state；先允许它们持有同一个 pool。
- 配置管理、analytics 查询和 capability gate 测试继续验证现有行为；在 M1 即加入禁止互相导入内部 handler/service/repository 的模块检查。

这一阶段不改变 schema、数据库部署、URL、容器或 runtime service 数量。

### 阶段 2：建立显式跨域只读 adapter

- 列出 Analytics、Collector、Processor 实际需要的 capability/configuration 字段。
- 为每种用途定义尽量小的静态只读类型，不传递完整 JSONB 管理文档。
- 将 definition revision 读取封装为明确的只读查询接口，并测试历史版本稳定性。
- 删除跨领域对内部 DTO、repository 和错误类型的直接引用。
- 若运行时配置读取当前由共享 crate 提供，确认其接口描述运行时 snapshot，而不是暴露管理 API 内部模型。

### 阶段 3：增加 Site registry 与原子 onboarding

- 先完成总规划 M3 的 Registry 回填和 M4 的配置权威切换，再按 [Site Onboarding and Settings Design](site-onboarding-settings-design.md) 增加站点列表/详情/创建接口。
- 由 Site Management service 事务化创建 site metadata、capabilities、activation windows、首个 environment policy 和 ingest key digest。
- 增加管理 audit、幂等/冲突语义以及明文 key 一次性返回规则。
- 保持 Analytics 仅使用 site identity 与必要配置读取 adapter，不允许反向写入 Site Management 数据。

### 阶段 4：Dashboard 改用管理 API 的 site directory

- 加入单独的 Site Management client 和 URL 配置。
- Site selector 从管理 API 获取站点集合；处理空站点、加载错误、无权限和归档状态。
- 实现站点 onboarding 和创建完成后的 SDK 安装信息。
- 对 Analytics 报表请求保留 Analytics client 和 Analytics response models。
- 分别测试两类 client 的错误、认证和响应校验。

### 阶段 5：强制模块边界并评估进一步拆分

- 增加静态架构检查或依赖测试，禁止 `analytics` 与 `site_management` 的内部路径互相导入。
- 通过 crate-private/public module visibility 限制可见范围。
- 复查 repository SQL ownership，确保管理模块不写分析事实、Analytics 不写配置文档。
- 根据真实安全、部署、团队和负载需求，决定是否拆 crate 或进程；共用 PostgreSQL 仍可保留。

## 测试与验收

- 现有 analytics 和 admin API HTTP contract 不因阶段 1 的搬移而改变。
- Site Management repository 测试覆盖并发更新、ETag 冲突、事务回滚、唯一约束和 key digest。
- Analytics 测试覆盖只读 definition revision 的选择、转换/漏斗报表结果和配置缺失/不可用行为。
- 站点端到端测试覆盖创建、Dashboard 发现、配置生效、Collector 接收事件、Processor 处理及 Analytics 查询。
- 架构检查证明两个业务 module 不 import 对方内部 handler/service/repository/model。
- 代码审查能为每张业务表和运行状态表指出当前写入者、目标写入 owner、显式迁移例外及跨域读取路径。
- 不要求两个领域独立部署，也不以物理数据库分离作为验收条件。

## 风险与缓解

- **只按文件搬家，没有限制依赖**：通过 module visibility、依赖检查和 repository ownership 验收，避免形成形式上的目录分层。
- **共享万能 state 继续传播**：拆分领域 state；仅共享 pool 等基础设施。
- **Analytics 直接依赖管理存储格式**：通过版本化只读 adapter 隔离 JSONB 文档与分析查询模型。
- **定义更新改变历史报表语义**：报表请求和结果始终明确绑定 definition revision/version。
- **双 API URL 初期相同令人困惑**：部署可以配置成相同地址，但 client 名称、认证用途和依赖保持分开。
- **Site 创建出现半成品**：所有必需记录由 Site Management service 在单一数据库事务中建立，并有回滚与幂等测试。
