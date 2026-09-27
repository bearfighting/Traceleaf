# Web Analytics Platform Roadmap

## 项目策略

项目按线性方式推进：一次只实施一个主要模块，完成并验证后再添加下一个模块。模块之间通过明确的契约衔接，不提前创建没有实际内容的长期空 package。

MVP 的最低成功标准是：一个网站接入 SDK 后，可以在 Dashboard 看到并配置完整的浏览、事件和基础性能分析。完整范围以 [MVP Scope](mvp-scope.md) 为准，发布前的测试、稳定性和部署门槛由 [MVP Release Readiness](release-readiness-design.md) 定义。

## Phase 0 — Project Foundation

详细执行方案见：[phase-0-design.md](phase-0-design.md)。

目标：建立 Monorepo、开发环境、Router Playground 和 Event Protocol V1，并完成基础工程治理。

当前状态：已完成。

交付：

- Monorepo 根目录和 workspace 配置
- `AGENTS.md`
- TypeScript / pnpm 基础配置
- `protocol/` 目录
- Event Protocol V1 初稿
- Protocol examples 和最小 validation fixture
- Next.js App Router Router Playground
- Docker / Docker Compose 开发环境
- `.env.example`、`.dockerignore` 和 Node / pnpm 版本锁定文件
- 最小的统一脚本入口结构
- GitHub Actions CI 和 Phase 0 架构决策记录

本阶段不创建或实现 Client SDK、Backend、Storage、Processor、API 或 Dashboard 模块。Router Playground 只是测试目标和行为参考，不包含 Analytics 实现。Compose 只提供基础开发环境，不提前容器化尚未存在的业务服务。

Router Playground 至少覆盖：

- 首次页面加载
- Next `<Link>` push navigation
- `router.push()`
- `router.replace()`
- 浏览器 back / forward
- pathname 变化
- search params 变化
- hash 变化的观察决策
- 动态路由页面
- 嵌套路由和共享 layout

Rust / Cargo workspace 不属于 Phase 0，等进入 Backend 阶段时再建立。PostgreSQL profile 同样延后到 Storage 阶段。验收：Monorepo 可以通过统一命令启动和验证基础开发环境；Protocol Schema、examples 和 fixture 可以自动校验；Router Playground 可以独立启动并复现常见导航场景，后续 Client SDK 可以直接接入测试。

## Phase 1 — Client SDK

详细实施方案见：[phase-1-design.md](phase-1-design.md)。

目标：实现第一个可使用的浏览器端 SDK，并建立可扩展的 Router Adapter 机制。

当前状态：已完成。SDK 已支持 Next.js App Router、Browser Context、有界内存 Buffer、flush 和本地 MockTransport workflow。

交付：

- `NavigationObserver` 接口
- `NavigationEvent` 类型
- `AnalyticsEvent` / `PageViewEvent` 类型
- `Transport` 接口
- `createAnalytics()`
- `pageview()`
- `observe()`
- 基础 `beforeSend()` 扩展点
- 基础事件 ID、有界内存 Buffer 和 flush
- `observer-next`，只支持 Next.js App Router
- 基础 Browser Context 采集
- 本地 MockTransport workflow

不实现 React Router、TanStack Router 或其他 Adapter。其他 Router 只通过接口设计保留扩展空间。

真实 Fetch/Beacon Transport、API endpoint 和 Backend 契约留待 Phase 2 确定后实现。

## Phase 2 — Backend Collector

详细实施方案见：[phase-2-design.md](phase-2-design.md)。

目标：创建 Backend 模块，接收 Client SDK 发送的 Event Protocol V1 事件。

交付：

- `POST /v1/events`
- Event Schema 校验
- site / environment 校验
- Origin allowlist
- Public Ingest Key
- 基础 payload / batch 限制
- 简单限流
- 内存或开发用接收适配器
- 健康检查、结构化日志

当前状态：已完成。已实现 Rust Collector、HTTP ingestion、Event Protocol V1 校验、Origin/CORS、Public Ingest Key、单进程限流、InMemory Sink 和 FetchTransport workflow。

本阶段暂不要求正式数据库存储；Backend 先能正确接收、校验和观测事件。

验收：SDK 可以向 Collector 发送事件，Collector 能返回明确的成功和错误响应。

## Phase 3 — Storage and Processing

详细执行方案见：[phase-3-design.md](phase-3-design.md)。

目标：添加 Storage 模块，使事件可以持久化并产生基础统计结果。

当前状态：Phase 3 PR1–PR5 已完成，下一步进入 Phase 4 Dashboard。

交付：

- PostgreSQL Adapter
- `raw_events` 表和 migration
- `page_view_totals` 累计聚合
- 幂等 Page View Processor
- `page_view_daily` 和 `page_view_routes` 聚合
- Timeline 和 Top Pages 查询
- Analytics API 的最小实现
- Client → Collector → PostgreSQL → Processor → Analytics API E2E workflow

本阶段不实现 Visitor、Session、Browser Dimensions 或低延迟处理；这些能力需要先完成独立的数据契约和 SDK 语义设计。

验收：Client SDK → Backend → PostgreSQL → Processor → Analytics API 完整链路可运行，重复事件不会造成重复 Page View 统计。

## Phase 4 — Dashboard

详细实施方案见：[phase-4-design.md](phase-4-design.md)。

当前状态：Phase 4 PR1–PR5 Dashboard workflow 已完成。

目标：添加 Dashboard 模块，让项目使用者可以直观看到网站使用情况。

交付：

- Overview 页面
- Page Views 总数
- Timeline
- Top Pages
- 日期范围
- Loading、Empty、Error 状态
- Site 选择的基础结构

Dashboard 不实现统计逻辑，只消费 Analytics API。

Phase 4 退出前通过 `pnpm e2e:dashboard` 验证 Collector → PostgreSQL → Processor → Analytics API → Dashboard 的完整流程。

## Phase 5 — Analytics Semantics and Identity Design

详细设计方案见：[phase-5-design.md](phase-5-design.md)。

当前状态：Phase 5 设计已完成。

目标：在实现 Visitor、Session 和浏览器维度之前，先完成指标语义、匿名身份和数据生命周期设计。

交付：

- Visitor 的定义、匿名 ID 生命周期和存储边界。
- Session 的 inactivity timeout、跨午夜、跨标签页和异常场景语义。
- `occurred_at`、`received_at`、迟到事件和重处理规则。
- Browser Context 字段的稳定 schema、版本和隐私边界。
- Referrer、UTM、Language、timezone、Device、Browser、OS 的指标定义。
- API 和 Dashboard 需要支持的维度、过滤器和空数据语义。
- 相关 ADR、Protocol/SDK 变更设计、canonical fixtures 和迁移计划。

本阶段以研究、契约和可验证 fixture 为主；没有稳定契约前，不实现正式 Visitor、Session 或维度聚合。

Country / IP、指纹识别和跨设备识别不属于本阶段设计目标。

## Phase 6 — Browser and Analytics Dimensions

详细实施方案见：[phase-6-design.md](phase-6-design.md)。

目标：根据 Phase 5 已确认的语义，实现浏览器上下文、匿名 Visitor、Session 和对应查询能力。

当前状态：Phase 6 PR1、PR2、PR3、PR4、PR5 实现和 E2E 验收已完成。

交付：

- 按已确认契约生成和持久化匿名 Visitor ID。
- Sessionization 和对应的 Processor 聚合。
- Referrer、UTM、Language / timezone、Device、Browser、OS。
- 对应 Raw Event / Aggregate migration。
- Analytics API 和 Dashboard 维度、筛选及空数据状态。
- Visitor、Session 和维度的端到端 fixtures。

Country / IP 不属于本阶段必须内容。

## Phase 7 — MVP Feature Completion

详细执行方案见：[phase-7-design.md](phase-7-design.md)。范围基线见：[MVP Scope](mvp-scope.md)。

当前状态：PR0–PR7 功能实现与验收已完成，详见 [Phase 7 PR7 验收记录](phase-7-pr7-acceptance.md)。Geo country-only 的实现、合成 E2E、本地 DB-IP smoke 与官方 checksum 核对已完成；真实流量 staging 部署评估列入 Release Readiness 跟进，Geo PR2 region/city 暂缓。

目标：在现有 Phase 6 Analytics workflow 上完成 MVP 所需的产品功能。

执行顺序：

```text
  Protocol consolidation
  → internal capability boundaries
  → Router adapters
  → Contract namespace consolidation
  → Unified Router entry and development profiles
  → Custom Events
  → Web Vitals
  → Conversion / Funnel
  → Geo
  → MVP functional acceptance
```

本阶段每项能力都必须完成 contract、实现、fixture、API/Dashboard 和最小 E2E，但不承担最终发布所需的完整浏览器矩阵和部署验证。

## Phase 8 — MVP Configuration and Capability Management

详细执行方案见：[phase-8-design.md](phase-8-design.md)。

目标：让用户通过 Dashboard 配置功能能力、Origin、Ingest Key、隐私和必要的业务设置，不暴露 Protocol、schema、generation 或 parser version。

执行顺序（严格串行；PR0、PR0.5a–e、PR1 contract、PR2 配置持久化、PR3 受保护配置 API、PR4 Collector Ingest Policy Runtime、PR5 Capability Runtime、PR6 Dashboard Core Configuration、PR7 Conversion/Funnel Definition Management 和 PR8 Configuration End-to-end Acceptance 均已完成。出口条件和记录见 [Phase 8 Design](phase-8-design.md#26-phase-8-顺序执行计划)）：

```text
PR0 Pre-configuration Hardening
  → PR0.5a–e Dependencies and Build Tool Refresh
  → PR1 Configuration Semantics and Contracts
  → PR2 Configuration Persistence and Migration
  → PR3 Protected Configuration API
  → PR4 Collector Ingest Policy Runtime
  → PR5 Processor and Analytics API Capability Runtime
  → PR6 Dashboard Core Configuration
  → PR7 Conversion/Funnel Definition Management
  → PR8 Configuration End-to-end Acceptance
```

交付：

- 前序 Phase 问题登记、修复和回归验证；
- capability 配置模型和 migration；
- 配置 API 和依赖校验；
- Origin / Ingest Key 管理；
- Conversion / Funnel 定义管理；
- Dashboard 配置界面；
- Collector、Processor、API 的统一配置语义；
- 配置生效、缓存、回退和回滚；
- 配置变更后的 E2E。

## MVP Release Readiness

详细执行方案见：[release-readiness-design.md](release-readiness-design.md)。

这是 MVP 的最后阶段，重点是在目标部署环境中验证 MVP 是否可重复部署和稳定运行，集中完成：

- CI、migration regression 和 integration test；
- Analytics E2E 和 Dashboard E2E；
- 浏览器矩阵和 SDK bundle/package 检查；
- Collector runtime hardening；
- retention policy 和 dry-run；
- 部署、backup、rollback 和 npm release；
- 干净环境 Release Candidate checklist。

## Phase 9 — Post-MVP Product Extensions

Phase 9 只保留需要独立隐私和产品设计的后续能力：

- Replay。
- Heatmap。
- 高级 Geo：例如 geospatial polygon、ISP/ASN、VPN/proxy detection 等。
- Geo region/city：在真实部署验证 country Geo 的覆盖率、数据质量和运维流程后，再单独评估并设计。

Replay 和 Heatmap 不属于 MVP。除非出现明确需求，否则不提前创建对应的 Protocol、migration、package 或服务。

## 后续专项 — Deployment Modes

当前 MVP 功能和发布准备完成后，再详细设计两种部署模式：

### Single-node Edition

面向个人项目、小型网站、本地或内网部署，目标是通过一个 tarball 和一个命令启动完整功能：

- 一个统一的 analytics server；
- SQLite 文件数据库；
- 内置 Collector、Analytics API 和 Processor worker；
- 内置 Dashboard 静态资源；
- 本地 migration、backup 和 restore 命令；
- 不依赖 PostgreSQL 或其他外部基础设施。

Single-node Edition 明确限制为单机、单写入进程和本地部署，不承诺多实例共享数据库文件。

### PostgreSQL Edition

面向标准自托管部署，继续支持独立组件：

```text
db-migrate
  → collector
  → processor
  → analytics-api
  → dashboard
```

PostgreSQL Edition 继续支持独立运维。该专项不属于当前 MVP，开始实施前新增独立设计文档，并重新评估 SQLite/PostgreSQL 的功能矩阵、升级路径和数据迁移方案。

## 后续方向

### 项目展示站与项目文档

MVP 完成生产环境部署验证后，可以规划独立的项目展示站，面向潜在使用者和贡献者介绍项目并承载持续更新。建议包含：

- 项目初衷、目标用户和核心功能；
- 架构和数据流说明；
- 安装、部署、配置和使用指南；
- Blog、开发进展和 Release 记录；
- 路线图、已知限制和未来发展方向。

展示站负责项目介绍、文档导航和发布信息；产品 Dashboard 继续负责用户自己的分析数据和站点配置。实施时再决定文档是否从仓库现有 Markdown 自动生成，避免维护两份互相漂移的指南。

只有出现真实需求后再考虑：

- Error Analytics
- [观测能力模块化与动态配置](feature-modularization-design.md)：Phase 7 建立内部 capability 边界，Phase 8 实现配置 API、持久化、Dashboard 管理、动态刷新和回滚。用户不配置 Protocol 版本、schema 或内部 rollout flag。
- 模块化实施顺序固定为：统一协议 → MVP 功能模块 → capability 配置模型 → 配置 API/持久化 → Dashboard 配置 → 动态刷新与回滚。
- 趋势 Summary / Insights API
  - 面向总体趋势和多维度聚合查询。
  - 可以评估 PostgreSQL Materialized View、rollup table 或其他预计算方案。
  - 需要单独定义数据新鲜度、刷新策略、`data_as_of` 语义和维度查询 contract。
  - 不改变当前 `/overview` 与 Reports API 的 Phase 3 contract。

## 阶段推进原则

每个阶段都必须保持以下顺序：

```text
Protocol / contract
  → implementation
  → fixture
  → end-to-end verification
```

优先交付可以运行的纵向切片，不因为未来功能提前引入大型基础设施。

模块创建规则：

- Phase 0 只创建工程骨架、Protocol、Router Playground 和 Docker 开发环境。
- 进入 Client SDK 阶段时，才创建 `packages/` 下的 SDK 和 Observer packages。
- 进入 Backend 阶段时，才创建 `services/collector`。
- 进入 Storage 阶段时，才创建 Rust domain、storage、processor 和 API 实现。
- 进入 Dashboard 阶段时，才创建 `apps/dashboard` 和 query client。
