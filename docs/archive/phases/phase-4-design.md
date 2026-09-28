# Phase 4 Design — Dashboard

> Status: Dashboard complete (PR1–PR5)
> Scope: Next.js Dashboard for Page Views, Timeline, Top Pages and basic site selection

## 1. Phase 4 定义

Phase 4 在 Phase 3 Analytics API 之上增加一个可使用的 Dashboard，展示网站的基础 Page View 统计：

```text
Analytics API
  → Dashboard Query Client
  → Next.js Dashboard
  → Overview / Timeline / Top Pages
```

Dashboard 只通过 Analytics API 查询，不直接访问 PostgreSQL，不实现统计逻辑，也不重新聚合 API 返回的数据。

Phase 4 的目标是完成第一个可用的管理界面，而不是建立完整的账号或 Analytics Semantics 系统。

## 2. 必须达成

- 新增独立的 `apps/dashboard` Next.js App Router 应用。
- Dashboard 可以选择站点并展示 Page Views。
- Dashboard 可以选择日期范围。
- 展示全站累计 Overview 和日期范围 Reports Overview。
- 展示 Timeline 和 Top Pages。
- 正确处理 loading、empty 和 error 状态。
- Dashboard 只访问 Analytics API，不直接访问数据库。
- Server-side query 使用配置的 Analytics API 地址。
- 不修改 Phase 3 Analytics API、Event Protocol、Storage schema 或 Processor 语义。
- 提供可重复执行的 Dashboard workflow 和基础端到端验证。

## 3. 不属于本阶段

- Visitor、Session、Bounce、Engagement 和 Browser Dimensions。
- 用户登录和站点管理 API。
- Dashboard 统计逻辑、客户端重新聚合和本地数据库访问。
- 流式刷新和复杂缓存系统。
- Materialized View、趋势 Summary 或新的 Analytics API 维度。
- 复杂图表编辑器、导出、报表分享和告警。
- React Router、TanStack Router 或其他网站 Router Adapter。

Phase 4 使用 Phase 3 已稳定的 Page View contract。Visitor、Session 和维度能力继续留到 Phase 5 进行语义设计，并在 Phase 6 实现。

## 4. Dashboard Contract

### 4.1 页面路由

初期 Dashboard 提供：

```text
/dashboard
```

站点和日期范围使用 URL search params 表达，便于刷新、复制和调试：

```text
/dashboard?site_id=site_playground&from=2026-09-01&to=2026-09-18
```

如果没有提供参数：

- `site_id` 使用配置的默认站点。
- `to` 使用当前 UTC 日期。
- `from` 使用 `to` 往前 29 天。
- 默认范围为包含首尾日期在内的 30 个 UTC 日。

默认范围是 Dashboard 的展示约定，不修改 Analytics API 的必填 path 参数或最大 366 天限制。

### 4.2 站点配置

Phase 4 不新增站点发现 API。Dashboard 通过配置获得允许选择的站点：

```text
DASHBOARD_SITES=site_playground,site_alpha,site_beta
DASHBOARD_DEFAULT_SITE=site_playground
ANALYTICS_API_URL=http://analytics-api:4002
```

站点配置由 Next.js 服务端读取。浏览器端不接收数据库连接信息，也不直接读取服务端 secret。

如果请求的站点不在配置列表中，Dashboard 显示空或配置错误状态，不通过接口探测站点存在性。

### 4.3 Analytics API 映射

Dashboard 使用现有 API：

```text
GET /v1/sites/{site_id}/overview
GET /v1/sites/{site_id}/reports/{from}/{to}/overview
GET /v1/sites/{site_id}/reports/{from}/{to}/timeline
GET /v1/sites/{site_id}/reports/{from}/{to}/pages?limit=20
```

语义：

- 全站 Overview：当前保留数据范围内的累计 Page Views。
- Reports Overview：选择日期范围内的 Page Views。
- Timeline：按 UTC 日期升序展示。
- Top Pages：使用 API 已排序的 `page_views desc, path asc` 结果。
- Dashboard 不重新排序、不重新求和、不改变 API 的空数据语义。

### 4.4 请求边界

初期由 Next.js Server Components 或 server-side query layer 请求 Analytics API：

```text
Browser → Dashboard server → Analytics API
```

这样可以避免浏览器直接请求本地 `4002` 产生 CORS 依赖，也不会把内部服务地址作为浏览器端业务 contract。

交互式站点和日期范围变更通过 URL 更新触发新的 server-side 查询。Phase 4 不引入客户端数据缓存库。

## 5. 页面状态契约

每个数据区域都必须能表达以下状态：

### Loading

请求参数变化后，在新数据返回前显示明确的加载状态。不能让用户误以为旧数据已经对应新的站点或日期范围。

### Success

返回数据时展示指标、日期和站点上下文。

### Empty

API 返回 200 但没有数据时：

- Overview 的 Page Views 显示 `0`。
- Timeline 显示空状态。
- Top Pages 显示空状态。
- 不把空数据当成 API 错误。

### Error

Analytics API 返回非 2xx、网络失败或响应结构无法解析时，显示用户可理解的错误状态，并保留当前查询上下文。

数据库错误只显示 API 的统一错误信息，不在 Dashboard 暴露内部数据库详情。

## 6. 推荐目录结构

```text
apps/dashboard/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── dashboard/
│       └── page.tsx
├── components/
│   ├── dashboard-shell.tsx
│   ├── site-selector.tsx
│   ├── date-range-picker.tsx
│   ├── overview-card.tsx
│   ├── timeline.tsx
│   ├── top-pages.tsx
│   └── states/
│       ├── loading-state.tsx
│       ├── empty-state.tsx
│       └── error-state.tsx
├── config/
│   └── sites.ts
├── lib/
│   └── analytics-api/
│       ├── client.ts
│       ├── errors.ts
│       ├── queries.ts
│       └── types.ts
└── package.json
```

目录是实现建议，不要求一次创建所有空文件。只有在对应 PR 开始时创建实际使用的模块。

## 7. 实施原则

### 7.1 Contract first

先固定 Dashboard 页面参数、默认日期范围、站点配置和 API 映射，再创建 Dashboard app。

### 7.2 Server-side first

Analytics API query client 初期在 Next.js 服务端运行。只有确实需要浏览器端交互时才引入 Client Component，并通过 URL 参数或服务端边界获取数据。

### 7.3 API 是唯一统计来源

Dashboard 不读取 Raw Events，不读取聚合表，也不复制 Processor 的聚合规则。所有 Page View 数值都来自 Analytics API。

### 7.4 小而完整的纵向切片

每个 PR 都应包含对应的组件、状态处理、测试和文档，不提前实现未使用的图表框架或通用设计系统。

## 8. PR 拆分

### PR1 — Dashboard Contract and App Skeleton

完成：

- 本文档和相关文档同步。
- 创建 `apps/dashboard` Next.js App Router 应用。
- 加入 workspace 和统一检查脚本。
- 建立 `/dashboard` 页面骨架。
- 实现站点配置和默认日期范围解析。
- 固定 loading、empty、error 的页面边界。
- 添加静态 mock fixture 或最小页面状态测试。

不实现真实 Analytics API 查询，不添加图表依赖。

### PR2 — Analytics API Query Client

完成：

- 实现 Analytics API response types。
- 实现 overview、range overview、timeline、pages 查询。
- 统一处理非 2xx、网络失败和 JSON 结构错误。
- 使用 `ANALYTICS_API_URL` 服务端配置。
- 测试 URL 构造、日期参数、limit 和错误映射。

不实现具体 Dashboard 统计展示。

### PR3 — Overview Dashboard

完成：

- 站点选择基础结构。
- 日期范围选择基础结构。
- 累计 Overview 卡片。
- 日期范围 Overview 卡片。
- loading、empty、error 状态。
- URL search params 与查询状态同步。

### PR4 — Timeline and Top Pages

完成：

- Timeline 展示。
- Top Pages 展示。
- 数据为空时的明确空状态。
- 日期范围变更后的完整刷新。
- 站点切换后的数据隔离。

初期使用项目现有技术栈和轻量 HTML/CSS 展示，不为了两个基础视图引入大型图表基础设施。

### PR5 — Dashboard Workflow and E2E Verification

完成：

- Dashboard Compose service 或独立开发启动方式。
- Dashboard 到 Analytics API 的 server-side 连接配置。
- 使用 canonical Phase 3 fixtures 验证页面数据。
- 验证站点切换、日期范围、空结果和 API 错误。
- 验证 Dashboard 不直接连接 PostgreSQL。
- 更新 getting started、Docker 文档和验收清单。

浏览器级测试工具只有在现有 Node/Next 工具不足时才新增，并单独说明依赖和运行前置条件。

PR5 使用 Playwright 验证真实 Dashboard 页面。Dashboard 作为 `dashboard` Compose profile service 运行，通过容器网络访问 `http://analytics-api:4002`；后端链路测试仍由 `e2e:analytics` 保持覆盖，Dashboard 完整链路使用 `e2e:dashboard`。

## 9. 测试策略

### 单元测试

覆盖：

- 默认站点选择。
- 默认 30 个 UTC 日范围。
- URL search params 解析。
- 非法日期范围处理。
- 站点配置解析。
- Analytics API URL 构造。
- API 错误映射。

### 组件测试

覆盖：

- Overview 正常数据。
- Timeline 正常数据。
- Top Pages 排序结果展示。
- loading 状态。
- empty 状态。
- error 状态。
- 站点切换和日期范围变化。

### 集成测试

使用 mock Analytics API 或可控的 HTTP server 验证：

- Dashboard query client 请求正确的 API path。
- Reports 请求始终携带 `from/to`。
- `limit` 默认传递为 20。
- API 的统一错误响应可以转换为 Dashboard error state。
- 未知站点和无数据不会导致页面崩溃。

### E2E workflow

使用 Phase 3 canonical fixtures：

```text
canonical fixture
  → Collector
  → PostgreSQL
  → Processor
  → Analytics API
  → Dashboard
```

至少验证：

- `single-page-view` 显示 Overview、Timeline 和 Top Pages。
- `multi-page-navigation` 显示正确的页面排序。
- `multi-site-isolation` 切换站点后数据不串站。
- `empty-date-range` 显示 0 和空状态。
- 自定义日期范围只查询对应范围。
- API 不可用时显示 error state。

## 10. Compose 与启动

Phase 4 可以新增 `dashboard` profile service，依赖 Analytics API；如果开发阶段采用宿主机 Next.js server，也必须保留明确的 `ANALYTICS_API_URL` 配置方式。

目标启动顺序：

```text
PostgreSQL healthy
  → migration complete
  → Collector / Processor / Analytics API
  → Dashboard
```

Dashboard 不需要数据库环境变量，只需要 Analytics API 地址和站点展示配置。

## 11. 文档与状态同步

Phase 4 实施过程中同步更新：

- `docs/phase-4-design.md`
- `docs/roadmap.md`
- `docs/README.md`
- `docs/getting-started.md`
- `docker/README.md`
- `README.md`

Phase 4 PR1 开始时状态为 `Planning complete; implementation not started`；PR1 完成后改为 `PR1 App Skeleton complete`，最终在 PR5 完成后改为 Dashboard complete，并将下一阶段指向 Phase 5 Analytics Semantics and Identity Design。

## 12. 验收标准

Phase 4 完成时必须通过：

```bash
pnpm check
pnpm test
pnpm protocol:validate
pnpm http:validate
pnpm analytics:contract:validate
pnpm test:integration
pnpm e2e:analytics
pnpm e2e:dashboard
pnpm dashboard:validate
pnpm build
docker compose --profile backend --profile storage --profile processing --profile dashboard config
git diff --check
```

同时满足：

- Dashboard 可以显示 Page Views、Timeline 和 Top Pages。
- 站点和日期范围筛选有效。
- loading、empty、error 状态可验证。
- Dashboard 不直接访问数据库。
- Phase 3 API contract 不被修改。
- Phase 5 的 Visitor、Session 和 Browser Dimensions 没有提前实现。

## 13. Phase 4 退出条件

以下链路可以在新环境中重复验证后进入 Phase 5：

```text
Browser SDK → Collector → PostgreSQL → Processor
  → Analytics API → Dashboard
```

并且：

- 页面数据与 Analytics API 响应一致。
- 多站点和日期范围不会互相污染。
- 无数据和 API 故障有明确 UI 状态。
- Dashboard 只通过 Analytics API 获取数据。
- 没有为 Dashboard 提前引入 Visitor、Session 或新统计维度。
