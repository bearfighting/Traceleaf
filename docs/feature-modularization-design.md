# 观测能力模块化与动态配置设计

> Status: Historical design — Phase 8 implementation and acceptance are complete; see [Phase 8 Design](phase-8-design.md) for the authoritative implementation record.
> Scope: Protocol consolidation 之后的能力模块化、站点配置和 Dashboard 管理

## 1. 目标

项目先完成统一 Event Protocol，再把采集、处理和查询能力按用户可理解的功能模块组织起来。最终用户配置的是“启用哪些观测能力”，而不是 Protocol V1/V2、schema、migration 或内部 feature flag。

目标顺序固定为：

```text
Protocol consolidation
  → MVP 功能完善
  → 内部能力模块化
  → Phase 8 配置 API 和持久化
  → Dashboard 功能配置
  → 动态策略刷新与端到端验证
```

本设计不要求在 Protocol consolidation 或 MVP capability contract 冻结之前引入动态配置中心。

## 2. 设计原则

### 2.1 Protocol 版本是内部实现细节

统一协议完成后，站点、SDK 和 Dashboard 不暴露 `schema_version` 选择、V1/V2 rollout 或 `protocol_v2_enabled`。未来真正的 breaking protocol 变化从正式协议的下一个版本开始，并由平台负责兼容期和迁移。

### 2.2 模块面向功能，不面向代码包

模块是产品能力边界，不等同于 package、service 或数据库表。第一批候选模块为：

- `page_views`：导航观察和 Page View 统计，基础模块；
- `browser_context`：语言、时区、屏幕、UTM 和受限 User-Agent 派生信息；
- `anonymous_visitors`：站点隔离的匿名 Visitor ID；
- `sessions`：服务端 Sessionization；
- `dimensions`：Browser、Device、OS、Referrer、UTM 等聚合；
- `custom_events`、`web_vitals`、`conversions`、`funnels`、`geo`：MVP 扩展模块，必须在 Phase 7 具备实际 contract 和实现后才能加入配置模型。

模块内部仍可拆分 SDK、Collector、Processor、API 和 Dashboard，但共享统一协议、权限和数据生命周期边界。

### 2.3 用户配置表达能力，系统处理依赖

用户只配置功能是否启用及必要的业务参数。模块依赖由服务端校验和处理，例如：

```text
sessions       → anonymous_visitors
dimensions     → browser_context
conversions    → custom_events
funnels        → conversions / custom_events
geo            → geo resolver / versioned dataset
```

不能要求用户理解 `context_schema_version`、generation、parser version 或 Processor rollout。

### 2.4 安全策略与产品能力分离

“是否统计 Browser Context”与“哪些 Origin 可以发事件”、“哪个 Ingest Key 有效”不是同一类配置：

- capability configuration：控制产品能力；
- ingest policy：控制请求是否可信和允许接收；
- consent：控制浏览器是否可以采集和发送；
- operator authorization：控制谁能修改配置。

后续动态配置不能削弱 Origin、Ingest Key、限流和权限控制。

### 2.5 Site、Environment、Origin 与 Identity

Ingest policy 和 Visitor identity 使用不同的约束：

- 一个 `site_id + environment` 可以配置多个允许接收请求的 Origin；
- 一个用于 Visitor/Session 的 identity site 在当前语义下应对应一个 canonical browser Origin；
- 如果多个独立网站需要分别统计 Visitor/Session，应使用不同的 `site_id`；
- 同一站点的多个部署环境必须使用不重叠的 Origin，避免 environment 无法唯一确定。

未来的站点管理界面必须在创建或修改配置时校验这组约束，不能让用户通过模糊的多 Origin 配置改变 Visitor 语义。

## 3. 目标配置模型

正式实现前应先冻结站点配置契约。建议逻辑模型如下，具体字段在对应 Phase 再确定：

```text
site
  id
  name
  environment
  enabled

site_capabilities
  site_id
  capability
  enabled
  settings
  updated_at

site_ingest_policies
  site_id
  allowed_origins
  public_ingest_keys
  rate_limit_policy
  updated_at
```

约束：

- `page_views` 默认是基础能力，不能被其他模块关闭后仍要求 Sessions 工作；
- 配置更新必须通过 API 做校验、审计并产生可追踪版本；
- 未识别的 capability、非法依赖和不兼容 settings 必须在保存时拒绝；
- Collector 不应直接依赖 Dashboard UI；Dashboard 通过 Analytics API 或独立 Configuration API 修改配置；
- Collector、Processor 和 API 必须使用同一份已持久化的配置语义；
- 配置读取需要明确缓存、刷新延迟和旧配置继续生效的失败行为。

初版不单独创建 Configuration Service。Analytics API 作为配置 API owner，在受保护的 admin namespace 提供站点和 capability 配置读写；Dashboard 只调用该 API，Collector、Processor 和公开查询 API 不依赖 Dashboard UI。

## 4. 实现优先顺序

### Step 0 — Protocol consolidation

按 [Protocol Consolidation Refactoring](protocol-consolidation-refactor.md) 合并 V1/V2：

- 单一 schema、TypeScript 类型、Rust 类型和 canonical fixtures；
- SDK 和 Transport 只发送统一协议；
- Collector 只保留一条校验和接收路径；
- 删除 `protocol_v2_enabled` 运行时分支；
- 在 Phase 8 migration 完成前保留 `analytics_enabled` 的产品/处理语义；迁移完成后由 capability 状态取代它。

验收重点是现有 Page View、Visitor、Session、Dimension 和 Dashboard 结果不变。

### Step 1 — MVP capability boundaries（Phase 7 PR1 已完成）

Phase 7 PR1 已在 `protocol/capabilities/` 冻结 Page Views、Browser Context、Visitors、Sessions、Dimensions、Custom Events、Web Vitals、Conversions、Funnels 和 Geo 的稳定内部边界。此阶段不新增动态站点配置，也不把当前开发期 feature flag 直接升级为用户配置。

### Step 2 — Capability contract implementation

在新增用户配置前，先为现有能力定义稳定的内部边界：

- SDK：事件生产和 consent 行为；
- Collector：接收策略和协议校验；
- Processor：每个能力的派生事实和重建边界；
- Analytics API：能力对应的查询契约；
- Dashboard：能力对应的展示、空数据和关闭状态。

每个模块都必须先有 contract、fixture、错误语义和关闭行为，再进行代码拆分。

这一步在 Phase 7 实现 Custom Events、Web Vitals 等能力时同步完成。每项能力必须先定义模块边界，再实现 SDK、Collector、Processor、API 和 Dashboard。

### Step 3 — Phase 8 配置 API 和持久化

先实现服务端配置模型，再实现 Dashboard 表单。至少需要：

- site 和 capability 的读写 API；
- 依赖校验和配置版本；
- migration 与默认配置；
- 权限、审计和敏感字段保护；
- Collector/Processor/API 的配置读取和刷新策略；
- 配置变更后的 E2E 验证。

环境变量只保留为 bootstrap、部署级默认值或紧急关闭开关，不能继续作为日常站点管理入口。

`analytics_enabled` 只作为当前 Phase 6 的过渡总开关。Phase 8 migration 必须将其映射为明确的 capability 状态：`page_views`、`anonymous_visitors`、`sessions`、`dimensions` 等，并定义默认值、失败回滚、旧字段是否保留以及关闭后历史数据是否仍可查询。该映射是 Phase 8 的必需交付，不再作为未来待评估事项。

### Step 4 — Dashboard 功能配置

Dashboard 只展示用户可理解的能力和设置：

- 能力启用状态；
- 必要的功能参数；
- Origin 和 Ingest Key 管理；
- consent 和隐私说明；
- 配置校验、保存结果和生效状态。

Dashboard 不显示 Protocol 版本、schema、generation、parser version 或内部 rollout flag。

### Step 5 — 动态刷新与发布

最后确定运行时配置刷新机制：

- 配置生效延迟和读取一致性；
- Collector、Processor、API 重启期间的行为；
- 配置回滚；
- 已发送事件与新配置的边界；
- 失败时使用旧配置还是拒绝请求；
- 审计日志和 operator 可见的生效状态。

## 5. 首批模块的依赖与优先级

| 优先级 | 用户能力              | 依赖                              | 说明                                |
| ------ | --------------------- | --------------------------------- | ----------------------------------- |
| P0     | Page Views            | 无                                | 当前 MVP 基线，默认启用             |
| P1     | Browser Context       | consent、统一协议                 | 先稳定采集边界，再暴露可选字段      |
| P1     | Anonymous Visitors    | consent、first-party storage      | 继续由服务端定义身份语义            |
| P1     | Sessions              | Anonymous Visitors                | 用户不配置 Session 算法细节         |
| P1     | Dimensions            | Browser Context、Processor parser | 用户只选择是否启用维度能力          |
| P2     | Custom Events         | 新事件类型 contract               | 单独设计 contract，不混入 Page View |
| P2     | Web Vitals            | SDK 采集和指标语义                | 需要独立采样与数据量评估            |
| P3     | Conversions / Funnels | Custom Events                     | 需要定义业务配置、回溯和版本化      |

## 6. 必须提前回答的问题

正式开始前必须补充设计并形成 ADR：

- 配置是 site 级、environment 级还是 project 级；
- 一个 site 是否允许多个 Origin；
- capability 关闭后，历史数据是否继续可查询；
- 新开启的能力是否需要 backfill；
- 配置变更是否需要 generation；
- 谁可以管理站点、Origin、Ingest Key 和隐私设置；
- Collector 如何在不依赖 Dashboard 的情况下安全读取配置；
- PostgreSQL Edition 与未来 Single-node Edition 如何共享配置语义；
- 配置服务不可用时，数据接收和处理是否继续使用最后已知配置。

以上问题在实现配置 API 前必须形成独立 ADR 或 Phase 8 设计补充；不能在 Dashboard UI 开发过程中隐式决定。

## 7. 完成定义

一个模块只有同时具备以下内容，才可以加入用户配置：

- 统一 Protocol contract 或明确的新事件 contract；
- SDK、Collector、Processor、API 和 Dashboard 实现；
- enabled、disabled、invalid configuration 和 empty data 测试；
- 权限、consent、Origin 和 Ingest Key 边界；
- migration、fixture 和端到端验证；
- 配置更新、回滚和旧数据处理说明。
