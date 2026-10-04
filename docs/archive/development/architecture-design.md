# Web Analytics Platform — Architecture Design

> Status: Draft
> Version: 0.1
> Scope: Initial architecture and MVP design

---

## 1. Overview

本项目目标是构建一个轻量、可扩展、framework-agnostic 的 Web Analytics Platform。

它最初主要解决：

- Page Views
- Visitors
- Sessions
- Routes
- Referrers
- UTM
- Geography
- Device / Browser
- 基础 Custom Events

但系统架构不与某个具体 Web Framework、Router、数据库或 Dashboard 实现绑定。

Next.js 将作为 first-class integration，同时支持：

- Next.js App Router
- React Router
- TanStack Router
- Manual Integration

未来可以继续扩展：

- Vue Router
- SvelteKit
- Solid Router
- Astro
- 普通 SPA
- 非 Framework Web Application

核心设计思想：

> Analytics 不直接观察 Router。
> Framework / Router Adapter 负责观察 Navigation，并将其转换为标准事件交给 Analytics Core。

整个系统进一步遵循：

> Observer 不知道 Analytics 如何统计。
> SDK 不知道数据如何存储。
> Collector 不知道数据如何展示。
> Processor 不知道 Dashboard 的存在。
> Storage 不知道谁在查询数据。
> Dashboard 不直接访问数据库。

---

# 2. Goals

## 2.1 Primary Goals

项目长期目标是建立可扩展的 Web Analytics Platform。MVP 聚焦浏览器端浏览、事件和基础性能分析，Next.js App Router 是首个一等集成，其他 Router Adapter 在 MVP 功能完善阶段加入：

1. 提供可靠的 Page View Analytics
2. 支持 SPA Navigation
3. Next.js App Router first-class support
4. 通过通用 Observer Contract 保持 Framework / Router 解耦
5. 保持 Client SDK 足够轻量
6. 支持基础匿名 Visitor 和简单 Session
7. 支持 MVP 范围内的 Router Adapter 和 Analytics Event，并为后续 Adapter 保留扩展契约

更复杂的隐私治理、导出和报表产品能力属于后续阶段；MVP 仍提供基础的站点配置、consent、Origin 和 Ingest Key 管理。

---

## 2.2 Non-Goals

第一阶段不追求：

- 完整用户行为分析
- Advertising Tracking
- Cross-site Tracking
- User Profiling
- Session Replay
- Heatmap
- A/B Testing
- Marketing Automation
- 复杂实时流处理
- 亿级事件基础设施

第一阶段首先把：

```text
PageView
Session
Visitor
Path / Page
Referrer
UTM
Device / Browser

Country / IP 不属于第一阶段的必要能力。
```

定义正确并稳定运行。

---

# 3. High-Level Architecture

整体系统：

```text
                     USER WEBSITE
                          │
                          ▼
                ┌──────────────────┐
                │    Observers     │
                │                  │
                │ Next.js          │
                │ React Router     │
                │ TanStack Router  │
                │ Manual           │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │  Analytics SDK   │
                │                  │
                │ Event            │
                │ Session          │
                │ Privacy          │
                │ Buffer           │
                │ Transport        │
                └────────┬─────────┘
                         │
                         ▼
                  Event Protocol
                         │
                         ▼
                ┌──────────────────┐
                │    Collector     │
                │                  │
                │ Validation       │
                │ Authentication   │
                │ Rate Limit       │
                │ Basic Enrichment │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │  Raw Event Log   │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │    Processor     │
                │                  │
                │ Normalize        │
                │ Enrich           │
                │ Deduplicate      │
                │ Sessionize       │
                │ Aggregate        │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │     Storage      │
                │                  │
                │ Events           │
                │ Sessions         │
                │ Aggregates       │
                │ Sites            │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │  Analytics API   │
                │                  │
                │ Query            │
                │ Filter           │
                │ Compare          │
                └────────┬─────────┘
                         │
             ┌───────────┼────────────┐
             ▼           ▼            ▼
         Dashboard      CLI       Integrations
```

---

# 4. Core Architectural Principles

## 4.1 Framework Agnostic

Analytics Core 不应该依赖：

```text
Next.js
React
React Router
TanStack Router
Vue
Svelte
```

Framework integration 应该通过 Adapter / Observer 完成。

---

## 4.2 Protocol First

Client 与 Server 之间唯一稳定的契约是：

```text
Event Protocol
```

而不是 TypeScript 类型，也不是 Rust struct。

例如：

```json
{
  "schema_version": 1,
  "type": "pageview",
  "event_id": "...",
  "occurred_at": "...",
  "site_id": "...",
  "path": "/vehicles/byd-seal"
}
```

协议应该是 language-neutral。

---

## 4.3 Dependency Direction

所有模块必须遵循明确的依赖方向。

禁止为了方便产生：

```text
Dashboard → PostgreSQL

Observer → Collector

Collector → Dashboard

SDK → Storage

Processor → Dashboard
```

---

## 4.4 Eventual Consistency

Analytics 不要求请求级强一致性。

基本流程：

```text
Collect
  ↓
Accept
  ↓
Process
  ↓
Aggregate
  ↓
Query
```

Dashboard 可以存在数秒到数十秒的数据延迟。

---

## 4.5 Privacy First

默认：

```text
No cross-site tracking
No fingerprinting
No advertising profile
No permanent IP storage
No unnecessary PII
```

系统应该尽量收集完成 Analytics 所需要的最少信息。

---

# 5. Observer Layer

Observer 负责观察外部系统。

例如：

```text
Next.js
React Router
TanStack Router
Browser APIs
```

然后转换成统一 Observation。

---

## 5.1 Navigation Observer

基本接口：

```ts
interface NavigationObserver {
  subscribe(listener: (event: NavigationEvent) => void): () => void;
}
```

标准 Navigation：

```ts
interface NavigationEvent {
  url: string;

  path: string;

  route?: string;

  title?: string;

  referrer?: string;

  navigationType?: "initial" | "push" | "replace" | "pop" | "unknown";

  timestamp: number;
}
```

---

## 5.2 Router Integrations

第一阶段：

```text
observer-next
observer-react-router
observer-manual
```

第二阶段：

```text
observer-tanstack-router
```

未来：

```text
observer-vue-router
observer-sveltekit
observer-astro
```

---

# 6. Route Identity

系统需要区分：

```text
URL
```

和：

```text
Route
```

例如：

```text
URL

/vehicles/byd-seal
/vehicles/byd-han
/vehicles/byd-song
```

对应：

```text
Route

/vehicles/:slug
```

事件可以同时保存：

```json
{
  "path": "/vehicles/byd-seal",
  "route": "/vehicles/:slug"
}
```

这样 Analytics 可以回答：

```text
Top Pages
```

以及：

```text
Top Routes
```

这是 Framework Adapter 可以提供的重要额外信息。

---

# 7. Analytics Client SDK

Analytics SDK 负责：

```text
Observation
    ↓
Analytics Event
    ↓
Context
    ↓
Privacy Filter
    ↓
Deduplication
    ↓
Buffer
    ↓
Batch
    ↓
Transport
```

---

## 7.1 Basic API

概念 API：

```ts
const analytics = createAnalytics({
  siteId: "...",
  endpoint: "...",
});
```

Manual Page View：

```ts
analytics.pageview();
```

Custom Event：

```ts
analytics.track("vehicle_compare", {
  vehicles: ["byd-seal", "model-3"],
});
```

Observer：

```ts
analytics.observe(observer);
```

---

# 8. Transport

Transport 与 Analytics Core 分离。

```ts
interface Transport {
  send(events: AnalyticsEvent[]): Promise<void>;
}
```

默认可能提供：

```text
FetchTransport
BeaconTransport
BatchTransport
```

生命周期：

```text
event
event
event
  │
  ▼
buffer
  │
  ├── size threshold
  └── timer
        │
        ▼
      batch
        │
        ▼
      transport
```

页面退出时可以使用：

```text
sendBeacon()
```

---

# 9. Event Protocol

Event Protocol 是 Client / Server 之间最重要的 contract。

长期协议可以支持多种事件；第一阶段只定义和实现 Page View：

```text
PageViewEvent
```

`CustomEvent` 保留为后续扩展，不属于当前阶段。

未来可以增加：

```text
WebVitalEvent
ErrorEvent
ConversionEvent
PerformanceEvent
```

---

## 9.1 Base Event

概念模型：

```ts
interface BaseEvent {
  schemaVersion: number;

  eventId: string;

  type: string;

  siteId: string;

  occurredAt: number;
}
```

服务器补充：

```text
receivedAt
processedAt
```

形成三个时间概念：

```text
occurredAt
receivedAt
processedAt
```

---

# 10. Schema Versioning

SDK 发布之后，不同网站不可能同步升级。

因此可能同时存在：

```text
SDK 0.2 → Schema V1

SDK 0.8 → Schema V2

SDK 1.3 → Schema V3
```

Collector 必须考虑：

```text
Backward Compatibility
```

协议必须包含：

```text
schema_version
```

---

# 11. Collector

Collector 的目标：

> 快速、可靠地接收 Analytics Event。

主要职责：

```text
Authentication
Site validation
Rate limiting
Schema validation
Basic normalization
Request metadata
Event acceptance
```

Collector 不负责复杂 Analytics 运算。

理想流程：

```text
POST /v1/events
       │
       ▼
validate
       │
       ▼
accept
       │
       ▼
202 Accepted
```

之后异步处理。

---

# 12. Raw Event Store

Raw Event 应尽可能作为不可变事实源。

```text
Collector
    │
    ▼
Raw Events
    │
    ▼
Processor
```

这样 Processing 算法改变以后，可以：

```text
Reprocess
Backfill
Reaggregate
```

Raw Events 可以设置 retention：

```text
30 days
90 days
etc.
```

长期数据主要保存 Aggregates。

---

# 13. Processor

Processor 是 Analytics 计算核心。

负责：

```text
Validation
Normalization
Deduplication
Bot Detection
Geo Enrichment
User-Agent Parsing
UTM Attribution
Sessionization
Route Normalization
Aggregation
```

Processing Pipeline：

```text
Raw Event
   │
   ▼
Normalize
   │
   ▼
Deduplicate
   │
   ▼
Enrich
   │
   ▼
Sessionize
   │
   ▼
Aggregate
   │
   ▼
Storage
```

---

# 14. Idempotency

每个 Event 必须具有：

```text
event_id
```

例如：

```text
UUID
UUIDv7
ULID
```

客户端：

```text
send
 ↓
timeout
 ↓
retry
```

不能导致：

```text
Page Views +2
```

Processor / Storage 应该能够识别重复 Event。

系统不需要追求严格的一致性语义。

目标是：

> Idempotent analytics processing.

---

# 15. Storage Layer

业务模块不应该直接绑定 PostgreSQL。

定义 Storage Interfaces：

```text
EventStore
SessionStore
AggregateStore
SiteStore
```

第一阶段：

```text
PostgreSQL Adapter
```

后续存储实现必须另行定义兼容性、迁移和数据生命周期契约。

---

# 16. Initial Storage Model

概念实体：

```text
sites

raw_events

sessions

daily_page_stats

daily_route_stats

daily_referrer_stats

daily_country_stats

daily_device_stats
```

具体数据库 schema 独立设计。

---

# 17. Analytics Domain

Analytics 指标必须具有严格定义。

例如：

```text
Page View
Visitor
Session
Bounce
Engagement
Visit Duration
Referrer
UTM Attribution
```

不能只定义数据库字段。

必须定义：

> 这个数字到底是什么意思？

例如 Session：

```text
什么时候开始？

什么时候结束？

多久 inactivity 算新 session？

跨 midnight 怎么处理？
```

这些属于：

```text
Analytics Domain Semantics
```

而不是 Dashboard 实现细节。

---

# 18. Analytics Query API

Dashboard 不直接访问数据库。

架构：

```text
Dashboard
    │
    ▼
Analytics API
    │
    ▼
Analytics Domain
    │
    ▼
Storage
```

初步 API：

```text
GET /sites/:id/overview

GET /sites/:id/pages

GET /sites/:id/routes

GET /sites/:id/referrers

GET /sites/:id/countries

GET /sites/:id/devices

GET /sites/:id/sessions
```

支持：

```text
Date Range
Filter
Grouping
Comparison
```

---

# 19. Dashboard

Dashboard 只负责：

```text
Visualization
Exploration
Filtering
Date Range
Comparison
Export
```

不负责 Analytics 业务计算。

第一阶段 Dashboard：

```text
Overview

Page Views
Visitors
Sessions

Page View Timeline

Top Pages
Top Routes
Referrers
Countries
Devices
Browsers
Operating Systems
```

---

# 20. Project / Site Management

即使第一阶段只有一个用户，也应该存在：

```text
Site
```

基本模型：

```text
Site

id
name
domains[]
apiKey
createdAt
```

未来：

```text
Account
   │
Organization
   │
Project
   │
Site
   │
Environment
```

例如：

```text
production
staging
development
```

---

# 21. Privacy and Data Governance

Privacy 应该从第一版考虑。

包括：

```text
IP retention
Cookie policy
Session lifetime
Consent
Do Not Track
Data retention
Data deletion
Data export
PII protection
Bot filtering
```

---

## 21.1 URL Sanitization

URL 可能包含：

```text
/reset-password?token=...

/search?q=...

/user/email@example.com
```

因此 SDK 应支持：

```ts
beforeSend(event);
```

用于：

```text
remove sensitive query params
remove PII
normalize paths
drop events
```

系统应该默认过滤常见敏感参数。

---

# 22. Monorepo Architecture

本项目适合采用 polyglot monorepo。

目标目录（按模块实施时逐步创建，不要求 Phase 0 一次性生成全部 package）：

```text
analytics/
│
├── examples/
│   └── nextjs-router-playground/
│
├── apps/
│   └── dashboard/
│
├── packages/
│   ├── analytics-core/
│   ├── analytics-browser/
│   ├── observer-core/
│   ├── observer-next/
│   ├── transport/
│   ├── protocol-ts/
│   └── query-client/
│
├── crates/
│   ├── collector/
│   ├── processor/
│   ├── analytics-domain/
│   ├── analytics-storage/
│   ├── storage-postgres/
│   └── analytics-api/
│
├── protocol/
│   ├── schemas/
│   ├── examples/
│   └── fixtures/
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
│
├── scripts/
│
├── docs/
│   └── decisions/
│
├── Cargo.toml
├── pnpm-workspace.yaml
├── package.json
└── compose.yaml
```

模块按以下顺序线性添加：

```text
Client SDK → Backend Collector → Storage / Processor / API → Dashboard
```

其他 Router Adapter 只在实际实施时新增对应 package。

---

# 23. Technology Direction

## Frontend / Browser

推荐：

```text
TypeScript
React
Next.js
pnpm
```

适合：

```text
SDK
Observers
Dashboard
Query Client
```

---

## Backend

推荐：

```text
Rust
```

适合：

```text
Collector
Processor
Analytics API
Storage
```

具体 Web Framework 后续决定，例如：

```text
Axum
```

---

## Database

MVP：

```text
PostgreSQL
```

不需要第一阶段引入：

```text
复杂基础设施
复杂处理链路
```

---

# 24. Cross-Language Boundary

TypeScript 和 Rust 不直接共享语言类型。

边界：

```text
TypeScript
     │
     ▼
Event Protocol
     │
 JSON / HTTP
     │
     ▼
Rust
```

Protocol 应该使用 language-neutral schema 描述。

例如：

```text
JSON Schema
```

未来 Query API 可以考虑：

```text
OpenAPI
```

---

# 25. Workspace Strategy

TypeScript（Phase 0 建立）：

```text
pnpm workspace
```

Rust（Backend 阶段建立）：

```text
Cargo workspace
```

两者保持各自原生工具链；Rust workspace 不作为 Phase 0 的启动依赖。

```text
              Project
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
 pnpm workspace       Cargo workspace
       │                   │
 TypeScript             Rust
```

不强求一个 monorepo 工具理解所有语言。

---

# 26. Project Scripts

跨语言 orchestration 通过 scripts 完成。

```text
scripts/

dev.sh
build.sh
test.sh
check.sh
lint.sh
generate-protocol.sh
db-migrate.sh
release.sh
```

例如：

```text
./scripts/check.sh
```

执行：

```text
Protocol validation
TS type check
TS tests
TS lint
Rust fmt
Rust clippy
Rust tests
Integration tests
E2E tests
```

CI 同样调用：

```text
./scripts/check.sh
```

保证：

```text
Local Development == CI
```

---

# 27. Local Development

基础设施使用 Docker Compose：

```text
compose.yaml

PostgreSQL
```

开发服务在对应模块完成后逐步加入：

```text
Collector      :4001
Analytics API  :4002
Dashboard      :3000
Processor      background worker
PostgreSQL     :5432
```

Phase 0 只启动 Router Playground 和基础开发环境；进入 Storage 阶段后再启用 PostgreSQL，其他服务在相应阶段加入。

例如：

```text
./scripts/dev.sh
```

负责：

```text
start Router Playground

optionally start PostgreSQL
```

---

# 28. Testing Strategy

Analytics 的测试重点不是单独函数，而是：

> 输入 Event 最终是否产生正确的 Analytics Result。

Fixtures：

```text
tests/fixtures/

simple-navigation.json

spa-navigation.json

duplicate-events.json

late-events.json

bot-traffic.json

utm-session.json

cross-midnight-session.json
```

例如：

```text
Input:

09:00 /home
09:01 /cars
09:02 /cars/byd-seal

Expected:

pageViews = 3
sessions = 1
visitors = 1

topRoute:
/cars/:slug
```

---

# 29. End-to-End Testing

完整测试：

```text
Fixture
   │
   ▼
Collector
   │
   ▼
Raw Event
   │
   ▼
Processor
   │
   ▼
Storage
   │
   ▼
Query API
   │
   ▼
Expected Analytics
```

这是系统最重要的测试之一。

---

# 30. Observability

Analytics Platform 自己也需要 observability。

至少需要：

```text
events received

events rejected

processing latency

queue depth

duplicate events

processing errors

database errors

API latency
```

但是：

> Analytics 系统自己的 observability 不应该依赖它自己。

第一阶段使用：

```text
Structured Logs
Metrics
Health Endpoint
```

即可。

---

# 31. Real-Time Strategy

第一阶段：

```text
Eventual Consistency
```

目标可以是：

```text
几秒 ～ 数十秒
```

而不是毫秒级更新。更短的新鲜度目标需要单独定义数据一致性和运行成本。

---

# 32. MVP Scope

本节保留架构层面的 MVP 摘要；完整范围、阶段顺序和发布门槛以 [docs/mvp-scope.md](../../mvp-scope.md) 为准。

除产品能力外，MVP 还包含 capability 配置 API、Dashboard 配置、Origin/Ingest Key 管理，以及 Release Readiness 定义的完整测试和部署验证。

Phase 0 只建立 Monorepo 基础骨架、Event Protocol V1、Next.js Router Playground 和 Docker / Docker Compose 开发环境。

MVP 完成后包含：

### Client

```text
analytics-core
analytics-browser
observer-next、observer-react-router、observer-tanstack-router
HTTP/Beacon transport
```

### Protocol

```text
PageViewEvent
EventBatch
Schema V1
```

### Backend

```text
Collector
Processor
PostgreSQL Storage
Analytics Query API
```

### Analytics

```text
Page Views
Visitors
Sessions
Pages
Routes
Referrers
UTM
Device
Browser
OS
Custom Events
Web Vitals
Conversions
Funnels
Geo
```

### Dashboard

```text
Overview
Timeline
Pages
Routes
Referrers
Countries
Devices
Events
Vitals
Conversions
Funnels
Geo
```

---

# 33. Future Extensions

MVP 之后可以增加：

```text
Error Analytics

Performance Analytics

CLI

Workspace Integration

Desktop Dashboard
```

这些能力不属于当前 MVP；是否规划新的产品模块或运行模式，留待真实产品需求出现后单独评估。

---

# 34. Architecture Rules

项目应长期坚持以下规则。

### Rule 1

Analytics Core 不依赖具体 Framework。

### Rule 2

Framework Adapter 只观察 Framework，不实现 Analytics 业务规则。

### Rule 3

Client / Server 通过版本化 Event Protocol 通信。

### Rule 4

Collector 只负责可靠 ingestion，不承担复杂统计。

### Rule 5

Raw Event 尽可能保持 immutable。

### Rule 6

Processor 负责 Analytics transformation。

### Rule 7

Storage 通过 abstraction 与业务层隔离。

### Rule 8

Dashboard 不直接访问数据库。

### Rule 9

Analytics 指标必须具有正式 semantic definition。

### Rule 10

Privacy 是 architecture concern，而不是后期补丁。

### Rule 11

Event 应支持基于 event_id 的简单去重和幂等处理。

### Rule 12

跨语言 orchestration 使用 project scripts，各语言内部使用原生工具链。

---

# 35. Recommended Design Documents

在本 Architecture 基础上继续拆分，统一放在 `docs/` 下：

```text
docs/

architecture-design.md
roadmap.md
monorepo-design.md
phase-0-design.md

event-protocol.md
metrics-semantics.md

client-sdk.md
observers.md
transport.md

ingestion.md
processing.md

storage.md
query-api.md

dashboard.md

privacy.md
testing.md

deployment.md
```

其中最优先：

```text
1. event-protocol.md

2. metrics-semantics.md

3. client-sdk.md

4. observers.md

5. ingestion.md

6. processing.md

7. storage.md

8. query-api.md

9. dashboard.md

10. testing.md
```

---

# 36. Final System Model

最终可以把整个系统理解成：

```text
External World
      │
      ▼
 Observation
      │
      ▼
Analytics Event
      │
      ▼
 Event Protocol
      │
      ▼
  Ingestion
      │
      ▼
 Raw Facts
      │
      ▼
 Processing
      │
      ▼
Analytics Domain
      │
      ▼
   Storage
      │
      ▼
 Query Model
      │
      ▼
Presentation
```

最核心的三个稳定边界是：

```text
Observation Contract

Event Protocol

Analytics Semantics
```

只要这三个边界保持稳定，Framework、Router、Transport、Backend 实现、数据库和 Dashboard 都可以独立演进。

---

# 37. Design Philosophy

这个项目不追求从第一天构建一个复杂的大规模 Analytics 基础设施。

优先级应该是：

```text
    Core Usefulness
    ↓
Clear Boundaries
    ↓
Privacy
    ↓
Reliability
    ↓
Developer Experience
    ↓
Performance
    ↓
Scale
```

MVP 的实现路线使用：

```text
TypeScript
+
Rust
+
PostgreSQL
+
HTTP
```

已经足以验证完整架构。

只有真实需求证明现有架构无法满足时，再重新评估基础设施边界。

最终目标不是构建一个绑定 Next.js 的 Page View Script，而是建立一个：

> **Framework-agnostic, protocol-driven, privacy-first Web Analytics Platform.**
