# Web Analytics Platform

为网站提供浏览器端浏览、事件和基础性能统计，并通过 Dashboard 查看和管理。

## 当前状态

MVP 范围已冻结。Phase 0–8 的功能和验收记录已归档；最新 CI 通过情况由项目维护者于 2026-09-27 确认。当前不再添加 MVP 功能。

产品运行后的待办集中在 [Post-MVP Follow-up](docs/post-mvp-follow-up.md)。冻结不代表已完成生产级运行、备份恢复或 SDK 正式发布验证。

## 核心 Workflow

Website → Browser SDK → Router Adapter → Event Protocol → Collector → PostgreSQL → Processor → Analytics API → Dashboard

当前 MVP 包含页面浏览、访客与会话分析、Browser Context、Custom Events、Web Vitals、Conversion/Funnel、country Geo，以及站点 capability 和 ingest policy 配置。完整范围见 [MVP Scope](docs/mvp-scope.md)。

## 开始使用

开发环境和本地运行步骤见 [Getting Started](docs/getting-started.md)。

## 文档入口

- [Documentation Index](docs/README.md)
- [MVP Scope and Freeze Record](docs/mvp-scope.md)
- [Roadmap](docs/roadmap.md)
- [Post-MVP Follow-up](docs/post-mvp-follow-up.md)
- [Architecture Design](docs/architecture-design.md)
- [Event Protocol](docs/event-protocol.md)
- [Release Readiness Freeze Record](docs/release-readiness-design.md)
- [Archived Phase 0–8 Records](docs/archive/README.md)

## 开发与验证

项目协作规则见 [AGENTS.md](AGENTS.md)。CI 运行统一的检查、测试、构建、migration、integration 和 E2E workflow。
