# MVP Scope

> Status: Accepted planning baseline
> Scope: MVP 功能范围、阶段依赖、完成定义和发布边界

## 1. MVP 定义

MVP 的目标是让一个网站所有者可以接入 Web Analytics Platform，采集浏览器端网站使用数据，并通过 Dashboard 查看和理解结果。

最小完整 workflow 为：

```text
Website
  → Browser SDK
  → Router Adapter
  → Event Protocol
  → Collector
  → PostgreSQL
  → Processor
  → Analytics API
  → Dashboard
```

MVP 必须覆盖从事件产生到用户查询的完整纵向链路，而不是只完成 SDK、Collector 或 Dashboard 的局部能力。

## 2. MVP 功能范围

### 2.1 已完成的核心能力

- Next.js App Router Adapter；
- Page Views；
- Anonymous Visitors；
- Sessions；
- Browser Context；
- Referrer、UTM、Language、Timezone；
- Device、Browser、OS；
- PostgreSQL Raw Events 和聚合；
- Analytics API；
- Dashboard Overview、Timeline、Top Pages 和基础维度查询。

### 2.2 MVP 功能完善

- 统一 Event Protocol，删除开发阶段 V1/V2 双轨；
- React Router Adapter；
- TanStack Router Adapter；
- Custom Events；
- Web Vitals；
- Conversion；
- Funnel；
- Geo country；
- 以上能力在 API 和 Dashboard 中的展示、筛选、空数据和错误状态。

Geo region/city 不纳入当前 MVP，作为后续 Geo 扩展。当前 MVP 提供 country 级别 Geo；region/city 需要单独评估精度、数据质量、隐私和部署边界后再规划。

### 2.3 MVP 用户配置

MVP 发布前需要提供面向功能的配置语义，但不把内部实现暴露给用户：

- capability 启用状态；
- Origin allowlist；
- Ingest Key；
- consent 和隐私选项；
- capability 依赖校验；
- 配置生效状态、失败回退和回滚。

用户不配置 Protocol 版本、schema version、generation、parser version 或内部 rollout flag。

MVP 配置只支持单部署管理员边界。可以使用部署级 secret 或等价的 admin credential 保护配置 API，但不实现组织、成员、角色或细粒度权限模型。

## 3. MVP 明确不包含

- Replay；
- Heatmap；
- 高级 Geo enrichment；
- Geo region/city；
- 多组织；
- 复杂权限模型；
- Kafka、ClickHouse 或其他专用基础设施；
- Realtime 或持续流式处理；
- 高吞吐、水平扩展或多区域部署；
- Single-node Edition；
- 复杂导出、报表分享、告警和 A/B Testing。

## 4. 阶段顺序

```text
Phase 0–6
  → Phase 7: MVP 功能完善和 capability contract
  → Phase 8: MVP 用户配置
  → Release Readiness: 测试、稳定性、部署和发布
  → Post-MVP extensions
```

功能开发优先于跨功能的上线保障，但每个功能仍必须同步完成单元测试、contract fixture 和基本 E2E。Release Readiness 再执行完整矩阵和干净环境验证。

## 5. 分类型完成定义

### Router capability

- 稳定的 `NavigationObserver` contract；
- Adapter 实现和真实 Router fixture；
- initial、push、replace、pop、search params 和 hash 行为测试；
- Browser SDK integration test 和最小 E2E；
- 不新增独立 migration、Storage 或 Processor 逻辑。

### Event / analytics capability

- 稳定的 Protocol 或 API contract；
- 所涉及的 SDK、Collector、Storage、Processor、API 和 Dashboard 实现；
- valid、invalid、disabled、empty 和重复事件测试；
- canonical fixtures 和跨语言校验；
- migration、重处理和升级说明；
- 至少一条完整 E2E workflow；
- 隐私、consent、Origin 和 Ingest Key 边界。

### Configuration capability

- 配置 schema、migration、API 和 Dashboard 表单；
- 依赖校验、admin credential 和审计边界；
- enabled、disabled、invalid、conflict、fallback 和 rollback 测试；
- 配置变更后的 E2E；
- 历史数据、backfill 和配置版本语义说明。

所有 capability 都必须具备文档、错误语义和回滚说明。

## 6. MVP 发布门槛

MVP 只有在以下条件全部满足后才算完成：

- 所有 MVP 功能已完成并通过功能验收；
- Protocol consolidation 已完成；
- 配置 API 和 Dashboard 配置语义已稳定；
- Geo region/city 已明确延期至 MVP 之后；
- migration 首次执行、重复执行和升级路径通过；
- PostgreSQL integration、Analytics E2E 和 Dashboard E2E 通过；
- CI 中现有的 Chromium Dashboard smoke test 通过；Firefox/WebKit 浏览器矩阵延期至 MVP 之后；
- Collector failure、shutdown、redaction 和 readiness 行为通过；
- retention 策略已批准，或自动删除明确延期且 dry-run 安全；
- 部署、backup、rollback 和 package release 文档可重复执行；
- Release Candidate checklist 在干净环境通过。
