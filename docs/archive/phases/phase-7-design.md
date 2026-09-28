# Phase 7 Design — MVP 功能完善

> Status: PR0–PR7 functional acceptance complete (2026-09-24). Geo country-only staging deployment evaluation is deferred until after the product is running; Geo PR2 remains deferred. See [PR7 acceptance record](phase-7-pr7-acceptance.md).
> Scope: Protocol consolidation、内部 capability 边界和 MVP 产品能力

## 1. 阶段目标

Phase 7 把 Phase 6 的 Page View、Visitor、Session 和 Dimensions 基线扩展为完整的 MVP 功能集。本阶段优先完成用户可使用的产品能力，不处理部署和 npm 发布工作；Firefox/WebKit 完整浏览器矩阵延期至 MVP 之后。

Phase 7 不改变现有 Page View、Visitor、Session 和 Dimension 的已确认语义，除非对应能力的 contract review 明确发现缺陷并新增 ADR。

## 2. 依赖顺序

```text
PR0 Protocol consolidation
  → PR1 Internal capability boundaries
  → PR2 Router adapters（已完成）
  → PR2.1 Contract namespace consolidation
  → PR2.5 Unified Router entry and development profiles
  → PR3 Custom Events ([design](phase-7-pr3-custom-events-design.md))
  → PR4 Web Vitals
  → PR5 Conversion and Funnel
  → PR6 Geo
  → PR7 MVP functional acceptance
```

PR2.1 是协议目录和 contract namespace 的基础清理，必须先于 PR2.5、PR3 和 PR4；PR2.5 是 PR2 的开发体验补充，不改变 Router Adapter 的观察契约；PR2.5、PR3 和 PR4 在 PR2.1 完成后可以并行；PR5 必须等待 PR3；PR6 可以和 PR3/PR4 并行，但必须先冻结隐私边界。

## 3. PR0 — Protocol consolidation

以 [Protocol Consolidation Refactoring](protocol-consolidation-refactor.md) 为实施依据：

- 合并 V1/V2 schema、类型、fixtures 和 examples；
- 统一为首次正式发布协议；
- SDK 和 Transport 只构造、发送统一协议；
- Collector 只保留一条 validation 和 ingestion path；
- 删除 `protocol_v2_enabled` 和 mixed-version runtime branch；
- 保留 `context_schema_version`，因为它描述 Browser Context，而不是 Event Protocol rollout；
- 保持 `site_id + event_id` 幂等、Visitor、Session 和 Dimension 结果不变。

验收：`protocol:validate`、TypeScript、Rust、Collector integration 和现有 Analytics/Dashboard E2E 全部通过；仓库不再有仅用于 V1/V2 rollout 的公共脚本和运行时分支。

## 4. PR1 — Internal capability boundaries（已完成）

定义以下内部 capability contract：

```text
page_views
browser_context
anonymous_visitors
sessions
dimensions
custom_events
web_vitals
conversions
funnels
geo
```

每个 capability 必须记录：

- 输入事件和依赖；
- Raw Event 是否保存原始字段；
- Processor 派生事实和 rebuild 边界；
- API 查询 contract；
- Dashboard 展示、disabled、empty 和 error 状态；
- consent、Origin、Ingest Key 和隐私边界。

本 PR 不实现 Dashboard 配置表单，不把 capability 开关直接暴露为环境变量。

## 5. PR2 — Router adapters（已完成）

实现 React Router 7 和 TanStack Router v1 Adapter：

- 只实现 `NavigationObserver`；
- 复用 Analytics Core、Browser SDK、Visitor ID 和 Transport；
- 覆盖 initial、push、replace、pop、search params 和动态路由；
- 明确 hash-only navigation 行为；
- 不在 Adapter 中实现 Session、统计或发送逻辑。

实现位于 `observer-react-router` 和 `observer-tanstack-router`，并通过两个独立 playground 与真实浏览器导航验证。Hash-only navigation 不产生标准 NavigationEvent。

验收：每个 Adapter 都有 observer contract test、Browser SDK integration test 和至少一个真实 Router fixture。

## 6. PR2.1 — Contract Namespace Consolidation

### 目标和边界（已完成）

Event Protocol 的 V1/V2 内容已经合并。PR2.1 已统一当前 contract namespace，避免把不同语义的版本号误解为并行 runtime 协议。

本 PR 不新增 breaking protocol，不实现兼容 runtime，不改变 Page View、Visitor、Session、Dimensions、Analytics API 或 Dashboard 结果。

### 统一规则

- Event Protocol 只有一份 canonical schema、examples 和 fixtures；所有当前事件都使用 `schema_version: 1`，不保留 Event V1/V2 双目录；
- 当前已确认的 V2 能力直接属于唯一初始协议，包括 `visitor_id`、Browser Context 和 `context_schema_version`；
- `context_schema_version` 只表示 Browser Context 语义版本，不表示 Event Protocol rollout；
- capability、semantic scenario 和内部 contract 的 source path 使用稳定的 current/canonical namespace，不通过多个版本目录表达当前实现；
- `/v1/events` 和 `/v1/sites/...` 如果继续作为公开 HTTP/API baseline，必须明确它们是唯一公开接口版本，不代表存在 V1/V2 runtime 双轨；
- 只有未来真正发生 breaking change 时，才允许引入新的公开 API 或 Event Protocol 版本。

### 已完成清理

- 删除 Event Protocol 的历史双目录和 compatibility 空目录；
- 将 capability、Browser Context、semantic scenario 以及内部 contract fixture 收敛到 canonical/current 路径；
- 将当前内部 contract 的 canonical layout 固定为：

  ```text
  protocol/events/{schemas,examples,fixtures}/
  protocol/capabilities/{capabilities.json,capability-contract.schema.json}
  protocol/contexts/browser-context.schema.json
  protocol/scenarios/analytics-semantics/cases.json
  protocol/contracts/analytics-api/current/
  protocol/contracts/http-ingestion/current/
  ```

- `analytics-api/current` 和 `http-ingestion/current` 的 source path 不携带内部版本目录；如果公开 HTTP API 继续使用 `/v1/sites/...` 和 `/v1/events`，该 `/v1` 只表示唯一当前公开 API baseline；
- 将混合版本 fixture 改为 generic unsupported-schema fixture；
- 将 legacy schema rejection 测试改为 `rejects_unsupported_schema_version`；
- 清理 Event Protocol rollout 专用的 runtime、测试和脚本命名；数据库中的历史 deprecated 字段保持不变；
- 更新 Rust、TypeScript、fixture validator、CI 和文档引用；
- 增加校验，禁止重新引入 Event Protocol 的 V1/V2 双目录或 runtime version branch。

历史 Phase 5/6 设计文档可以保留迁移背景，但必须明确它们不定义当前 runtime contract。生产 schema 继续使用编译期嵌入或稳定 canonical path，不通过工作目录或临时环境变量选择协议版本。

### 验收

- 只有一份当前 Event Protocol schema 和 fixture namespace；
- 代码、脚本、测试和文档不再依赖 Event Protocol V1/V2 双轨；
- 从任意工作目录执行 Rust、TypeScript 和 fixture validation 都能找到 canonical resources；
- `pnpm protocol:validate`、`pnpm analytics:contract:validate`、`pnpm http:validate`、`pnpm check`、`pnpm test`、integration 和相关 E2E 通过；
- PR2.5、PR3 和 PR4 不需要再为 protocol path 或版本命名做额外兼容处理。

## 7. PR2.5 — Unified Router Entry and Development Profiles（已完成）

### 目标和边界

PR2.5 在 PR2 独立 Adapter 之上提供一致的用户接入体验和一致的本地开发入口：

- 用户只需要创建一次 `analytics`，再挂载一个统一命名的 Router Bridge；
- Router-specific Adapter 仍保持独立 package、独立 peer dependency 和独立生命周期；
- `analytics-browser` 不自动探测 Router，不依赖 React Router 或 TanStack Router，不把 Router 类型暴露到 SDK 核心；
- 开发者可以通过参数选择 Next、React Router 或 TanStack Router playground；
- Docker Compose 可以只启动指定 playground，并与 backend、storage、processing、dashboard profiles 组合使用。

PR2.5 不实现自动 Router 检测、多个 Router 同时挂载、Router 配置持久化、capability 配置、Protocol 版本选择或新的 NavigationEvent 语义。

### 统一 Router 接入 API

新增一个 facade package，例如 `@web-analytics/router-adapters`。Facade 只负责统一入口和 re-export，不重新实现观察逻辑：

```text
@web-analytics/router-adapters/next
  → @web-analytics/observer-next
  → @web-analytics/observer-core

@web-analytics/router-adapters/react-router
  → @web-analytics/observer-react-router
  → @web-analytics/observer-core

@web-analytics/router-adapters/tanstack-router
  → @web-analytics/observer-tanstack-router
  → @web-analytics/observer-core
```

三个 subpath 都导出同名组件 `RouterAnalyticsBridge`，使应用代码只需替换 Router 集成的 import：

```tsx
import { createAnalytics } from "@web-analytics/analytics-browser";
import { RouterAnalyticsBridge } from "@web-analytics/router-adapters/react-router";

const analytics = createAnalytics({ siteId: "site_demo", transport });

function App() {
  return (
    <BrowserRouter>
      <RouterAnalyticsBridge analytics={analytics} />
      <Routes />
    </BrowserRouter>
  );
}
```

Next.js App Router 只替换为：

```tsx
import { RouterAnalyticsBridge } from "@web-analytics/router-adapters/next";
```

TanStack Router 只替换为：

```tsx
import { RouterAnalyticsBridge } from "@web-analytics/router-adapters/tanstack-router";
```

Facade 必须满足：

- 统一 `RouterAnalyticsBridge` 命名和 props 语义；
- 内部把 `analytics` 绑定到现有 `NavigationEventSink`，不要求用户手动创建 observer 或调用 `analytics.observe()`；
- 不在 package root 静态引入三个 Router，保持按 subpath tree-shaking；
- 对应 Router 依赖继续作为 subpath package 的 peer dependency；
- Provider 约束保持明确：Bridge 必须位于对应 Router Provider 内；
- 仍支持多个消费者，但不允许同一个页面隐式挂载多个不同 Router Adapter。

不采用 `analytics.observeRouter("react-router")` 作为唯一 API。Router Adapter 依赖 React hooks，必须在对应 Provider 的组件树中执行；普通初始化函数无法正确表达这个生命周期约束。

### 开发服务器参数化

统一开发命令：

```bash
pnpm dev --router next
pnpm dev --router react
pnpm dev --router tanstack
```

允许提供等价的简写：`pnpm dev:next`、`pnpm dev:react`、`pnpm dev:tanstack`。

脚本必须使用固定 allowlist，不接受任意 package 名称：

| 参数       | workspace package                           | 默认端口 |
| ---------- | ------------------------------------------- | -------- |
| `next`     | `@web-analytics/nextjs-router-playground`   | `3000`   |
| `react`    | `@web-analytics/react-router-playground`    | `3101`   |
| `tanstack` | `@web-analytics/tanstack-router-playground` | `3102`   |

未知参数必须返回使用说明和非零退出码。默认 `pnpm dev` 继续启动 Next playground，端口、host 和额外 Vite/Next 参数可以透传，但不能改变 Router 选择的 allowlist。

### Docker Compose playground profiles

Compose 为每个 playground 提供独立 service/profile：`playground-next`、`playground-react` 和 `playground-tanstack`。

推荐通过统一 wrapper 使用：

```bash
pnpm docker:dev --router next
pnpm docker:dev --router react
pnpm docker:dev --router tanstack
pnpm docker:dev --router react --with-backend
```

等价的底层 Compose 命令必须保持可用：

```bash
docker compose \
  --profile playground-react \
  --profile backend \
  --profile storage \
  --profile processing \
  up --build --wait
```

要求：只启动所选 playground；使用统一的 transport、endpoint、ingest key 和 site ID 环境变量；backend、storage、processing、dashboard 仍是独立 profile；不同 playground 使用不冲突的默认端口并允许环境变量覆盖；默认 Compose 开发行为继续保持 Next 兼容；wrapper 对参数和 profile 组合进行校验，错误时不启动部分服务。

### 验证和完成标准

必须覆盖 facade export contract、三个 Router 的统一 Bridge integration、开发参数校验、三个 Compose profile config、指定 playground 启动和错误参数 E2E，以及 initial、push、replace、pop、search、hash-only 行为不变。现有 `pnpm e2e:router-adapters`、Analytics E2E 和 Dashboard E2E 必须无回归。

PR2.5 完成后，新用户只需要选择对应 Router 的一个 facade import 并挂载统一命名的 Bridge；开发者只需要修改一个 `--router` 参数即可切换 playground，不需要手动修改 Compose service、SDK observer wiring 或 transport 代码。

## 8. PR3 — Custom Events

> Status: Implemented; E2E acceptance complete

Detailed contract, limits, privacy boundary, persistence plan and acceptance sequence are frozen in [Phase 7 PR3 Custom Events Design](phase-7-pr3-custom-events-design.md) and [ADR-009](../../decisions/ADR-009-custom-events-contract.md).

### Contract

定义独立于 Page View 的 Custom Event contract：

- 稳定 event type 和 event name；
- site 隔离和 event id 幂等；
- properties 允许的 JSON 类型、深度、大小和 key 数量；
- 禁止原始 IP、原始 User-Agent 和敏感身份字段；
- occurred/received 时间语义；
- 未知字段和非法 properties 的错误行为。

### Workflow

```text
SDK event()
  → Protocol validation
  → Collector
  → raw_events
  → event facts / aggregates
  → Analytics API
  → Dashboard
```

### 验收

- 单事件、多事件、重复事件、非法属性和超限 payload fixture；
- Collector integration；
- Processor 幂等和重处理测试；
- API 查询和空数据状态；
- Dashboard 基础事件列表或聚合展示；
- 完整 E2E。

## 9. PR4 — Web Vitals

首版支持 LCP、INP、CLS、FCP 和 TTFB。MVP 固定返回 `count`、`p75` 和 `good / needs_improvement / poor` 样本数量，不要求 p50、p90 或 attribution 聚合。MVP 查询按 site、date range 和 route 聚合，每个 Page View 每个 metric 只保留最后一次有效上报；样本不足时返回 `insufficient_data`。还必须明确：

- 每次 Page View 的关联关系；
- browser API 不可用时的降级；
- 采样和重复上报规则；
- metric value、rating 和 navigation type 的 schema；
- raw metric 与聚合结果的保留关系；
- Dashboard 的空数据和低样本提示。

验收覆盖 browser mock、真实浏览器采集、非法 metric、重复 metric、Processor 聚合和 Dashboard 展示。

## 10. PR5 — Conversion and Funnel

Conversion/Funnel 依赖 Custom Events，Phase 7 只实现内部能力和固定 contract，不实现用户配置页面。首版只支持明确的事件型规则：

- conversion 由 event name 和必要 properties 定义；
- funnel 由有序 steps 定义；
- 统计窗口、重复事件和缺失步骤语义固定；
- 不引入用户登录身份或跨设备合并；
- API 返回步骤数量、转化率和数据新鲜度。

必须提供定义、查询和错误 contract，并覆盖重复事件、乱序事件、超时事件、空漏斗和非法定义场景。测试可以使用 fixture 或部署级静态定义；用户创建和修改定义属于 Phase 8。

## 11. PR6 — Geo

> Status: Country-only Geo PR1 implementation, deterministic synthetic-MMDB E2E, local DB-IP parser smoke and official checksum verification complete; staging coverage/update evaluation is deferred until after the product is running; Geo PR2 region/city deferred

### Geo PR1

- country / country code；
- 不保存原始 IP；
- 明确 provider、dataset 和 parser version；
- 明确 provider 是随部署提供的本地数据集还是受控外部服务；
- 明确数据文件、版本更新、缺失数据和离线部署行为；
- 无法解析时使用 unknown；
- API 和 Dashboard 支持按国家查看。

PR1 implementation contract:

- Collector reads a local MaxMind GeoLite2 Country or DB-IP City Lite MMDB at `GEOIP_DATABASE_PATH`; only `country.iso_code` is extracted from either dataset. The backend Compose profile mounts `./data` read-only at `/workspace/data`. No online downloads or external lookup requests are made.
- Collector startup fails for a missing, unreadable, or unsupported database. Operators update the file offline and restart the Collector; the persisted dataset release is the MMDB database type plus build epoch.
- TCP peer address is authoritative by default. `X-Forwarded-For` is accepted only when the peer matches an explicitly configured `GEOIP_TRUSTED_PROXIES` CIDR, walking from right to left and skipping trusted hops.
- Raw IP exists only during request handling and is never persisted or logged. Geo enrichment stores country code, provider, dataset release, and parser version outside the event payload; unresolved values use `unknown`.
- Processor builds idempotent `geo_country_facts` and supports `processor --rebuild-geo-country --site-id <site_id>` from saved enrichment metadata. Rebuild does not re-resolve historical IPs.
- Country report route: `GET /v1/sites/{site_id}/reports/{from}/{to}/geo`; items contain ISO alpha-2 `country_code` and Page View count, including `unknown`. The response lists providers present in the selected date range so the Dashboard can show DB-IP attribution only when needed. `coverage_from` reports the UTC receipt date of the earliest Geo-enriched Page View; the Dashboard warns when a selection starts earlier or the coverage start is unknown.
- Decision and region/city deferral are recorded in [ADR-011](../../decisions/ADR-011-geo-country-privacy.md). Unknown share, dataset release, offline startup, and IP non-persistence are the PR1 evaluation record.

### Geo PR2

只有 Geo PR1 通过数据质量、隐私和部署评估后才实施 Geo PR2：

- region / city；
- 精度和 unknown 语义；
- retention 和重新解析策略；
- 不把精确位置作为默认展示或身份标识。

Geo PR2（region/city）已决定延期至 MVP 之后，不阻塞其他 MVP capability。Country Geo 的 staging 覆盖率、数据更新和回滚评估也列为产品实际运行后的运维工作，不作为 MVP 退出条件。

## 12. 测试策略

功能开发期间同步完成：

- contract fixtures；
- TypeScript 和 Rust unit tests；
- Collector integration；
- Processor idempotency/rebuild tests；
- API contract tests；
- Dashboard component tests；
- 每个 capability 的最小 E2E。

完整 CI、migration regression、Collector hardening 和部署验证统一放在 [Release Readiness](../../release-readiness-design.md)；Firefox/WebKit 完整浏览器矩阵延期至 MVP 之后。

## 13. PR7 — MVP functional acceptance

PR7 汇总 Phase 7 的功能验收，不新增产品能力。必须验证：

- Protocol consolidation 后的统一 schema、TypeScript、Rust 和 fixtures；
- Page View、Visitor、Session、Dimensions 的结果无回归；
- React Router 和 TanStack Router 的 initial、push、replace、pop、search params 和 hash 行为；
- Custom Events 的单事件、多事件、重复事件、非法 properties 和超限 payload；
- Web Vitals 的 `count`、`p75`、rating counts、低样本和 API empty state；
- Conversion/Funnel 的重复、乱序、超时、空结果和非法定义；
- Geo country 的解析成功、unknown 和 provider dataset version；
- 所有可配置的 Analytics capability 的 enabled、disabled、invalid 和 empty 状态；
- 所有 Router Adapter 的 observer contract、导航行为和最小 E2E；
- Analytics API、Dashboard 和完整 MVP fixture workflow。

如果 Geo PR2 未通过评估，PR7 必须记录延期原因和后续验收条件，不得把它默认为已交付。

## 14. Phase 7 退出条件

- PR0–PR7 的 contract、实现、fixture、功能 E2E 和最终功能验收完成；
- Page View、Visitor、Session、Dimensions 结果无回归；
- 所有可配置的 MVP Analytics capability 有明确 enabled、disabled、invalid 和 empty 语义；
- 所有 MVP Router Adapter 有明确 observer contract、导航行为和最小 E2E；
- Analytics API 和 Dashboard 能展示已承诺的 MVP 功能；
- Geo PR2（region/city）已明确延期至 MVP 之后；
- Phase 8 的配置模型可以基于这些稳定 capability contract 开始设计；
- 未把发布基础设施或内部协议细节暴露给最终用户。

## PR4 Web Vitals implementation

PR4 records document-load LCP, INP, CLS, FCP and TTFB from `web-vitals@6.2.2` under consent. Web Vital reports carry a Page View event ID, route and timestamp snapshot; daily attribution uses the Page View UTC date. Soft-navigation metrics and attribution are excluded. Each Page View/metric retains its highest `report_sequence` in `web_vital_facts`; the raw payload remains available for rebuild. Rating boundaries follow the frozen protocol thresholds (LCP 2500/4000 ms, INP 200/500 ms, CLS 0.1/0.25, FCP 1800/3000 ms, TTFB 800/1800 ms). The report API groups by route and metric and suppresses p75 below four samples.

## PR5 Conversions and Funnels implementation

Conversion and Funnel definitions are stored as immutable, site-scoped revisions. `ANALYTICS_DEFINITIONS_FILE` (default `config/analytics-definitions.json`) is read only by the explicit one-time import command `processor --import-definitions-if-empty`; imported sites retain the file version label and are never overwritten by a repeated import. Processor selects a revision using each event’s Collector `received_at`, and regular processing writes facts only for active definitions. Conversion property predicates use type-sensitive equality for top-level JSON scalars. Funnel steps are strictly ordered within an existing anonymous Session; the first step’s UTC date is the cohort date, and sessions are split at UTC midnight. Reports default to the current site revision and accept `definition_version` to inspect history. Historical facts are recalculated only by the explicit operator command `processor --rebuild-conversion-funnels --site-id <site_id> --definition-version <version>`. For Compose, run the initial import after migrations and capability configuration with `docker compose --profile processing run --rm --no-deps --entrypoint cargo processor run -p processor -- --import-definitions-if-empty`. Properties and Visitor IDs stay out of API responses and Dashboard.
