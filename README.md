# Web Analytics Platform

一个 framework-agnostic、privacy-first、self-host friendly 的 Web Analytics Platform。

项目 MVP 聚焦于：

> 为网站提供浏览器端浏览、事件和基础性能统计，并通过 Dashboard 管理和查看结果。

## 当前状态

项目状态：

- 已完成：Phase 0–6 核心 Analytics workflow；Phase 7 的 Router Adapter、Custom Events、Web Vitals、Conversion/Funnel 和 Geo country 功能及阶段验收；Phase 8 PR0–PR8 用户配置与能力管理及端到端验收。
- 下一阶段：MVP Release Readiness。首先量化并完成本地 Docker E2E 缓存优化，然后在目标部署环境完成完整回归、运行时、数据保留、备份恢复和回滚验证；Firefox/WebKit 浏览器矩阵与 Geo region/city 延期至 MVP 之后。
- Phase 8 验收记录：`pnpm e2e:configuration`、`pnpm check`、`pnpm test`、`pnpm test:migrations`、`pnpm test:integration`、`pnpm e2e:analytics`、`pnpm e2e:dashboard` 和 `pnpm build` 均通过，详见 [Phase 8 Design](docs/phase-8-design.md)。
- MVP 发布验证之后可规划项目展示站，集中介绍项目初衷、功能、架构、部署方式、使用指南、Blog 和 Release 进展。

当前已具备：

- Monorepo 基础结构
- Event Protocol V1 Schema、examples、fixtures 和自动校验
- Next.js、React Router 和 TanStack Router Playground，以及统一的 `@web-analytics/router-adapters` facade
- `observer-core`、三个 Router observer adapter 和 `analytics-core` 的基础实现
- `analytics-browser` 的事件 runtime、Browser Context 和可注入 Transport contract
- `analytics-browser` 的有界内存 Buffer、定时 flush 和本地 Mock workflow
- `@web-analytics/transport` 的 FetchTransport 和 Collector 错误映射
- Docker / Docker Compose 开发环境
- Rust Collector foundation、TOML 配置加载和 `/health` 健康检查
- `POST /v1/events`、Event Protocol V1 校验、Origin/CORS、Public Ingest Key、单进程限流和 InMemory Sink
- PostgreSQL `raw_events` migration、幂等 Raw Event Sink 和 storage Compose profile
- Page View Processor、daily/routes/totals 聚合和 processing Compose profile
- Analytics API 的 Overview、Reports、Timeline、Top Pages 和 processing Compose profile
- Dashboard 的 Overview、Timeline、Top Pages、Compose service 和 Playwright E2E workflow
- 统一初始 Event Protocol、Visitor ID / Browser Context contract 和单一路径 Collector ingestion
- Phase 7 capability contract、依赖图和跨语言 registry adapter
- Custom Events 从 Browser SDK 到 Dashboard 的完整链路，含隐私受限 properties、独立处理 watermark 和 daily event-name reports
- Web Vitals、Conversion/Funnel 和 Geo country 的采集、处理、查询及 Dashboard 展示
- Phase 8 的版本化 capability 与 environment policy、受保护配置 API，以及 Collector、Processor 和 Analytics API 的运行时配置

Phase 0 的 Event Protocol、Router Playground、Docker 开发环境和基础工程治理已经完成。可以参考 [Getting Started](docs/getting-started.md) 启动项目。

Storage、Processor、Analytics API 和 Dashboard 按照路线图线性实现。Playground 默认使用 MockTransport；显式配置后可以向本地 Collector 发起真实 API request。

## 目标 Workflow

```text
Next.js Website
  → Browser SDK
  → Next.js Navigation Observer
  → Event Protocol
  → Collector
  → PostgreSQL
  → Processor
  → Analytics API
  → Dashboard
```

## MVP 范围

MVP 的权威范围、阶段依赖和退出条件见 [MVP Scope](docs/mvp-scope.md)。当前 MVP 包含：

- Page Views、Visitors、Sessions 和 Browser Context；
- Referrer、UTM、Language、Timezone、Device、Browser、OS；
- React Router 和 TanStack Router Adapter；
- Custom Events 和 Web Vitals；
- Conversion、Funnel 和基础 Geo；
- capability 配置、Origin、Ingest Key 和隐私设置；
- PostgreSQL Edition、Analytics API、Dashboard 和完整发布验证。

Replay、Heatmap、Geo region/city、复杂 Geo、单机版部署和其他未来扩展不属于当前 MVP。

## 开发顺序

```text
Phase 0  Monorepo、Protocol、Router Playground、Docker
Phase 1  Client SDK 和 Next.js Adapter
Phase 2  Backend Collector
Phase 3  Storage、Processor、Analytics API
Phase 4  Dashboard
Phase 5  Analytics Semantics 和 Identity Design
Phase 6  Browser 和 Analytics Dimensions
Phase 7  MVP 功能完善
Phase 8  MVP 用户配置与能力管理
Release Readiness  测试、稳定性、部署和发布
Post-MVP         实际使用反馈、Geo region/city 评估、项目展示站与文档入口
```

## 文档

详细设计文档位于 [docs/](docs/README.md)：

- [Architecture Design](docs/architecture-design.md)
- [Roadmap](docs/roadmap.md)
- [MVP Scope](docs/mvp-scope.md)
- [Monorepo Design](docs/monorepo-design.md)
- [Phase 0 Design](docs/phase-0-design.md)
- [Event Protocol](docs/event-protocol.md)
- [Router Playground](docs/router-playground.md)
- [Phase 1 Design](docs/phase-1-design.md)
- [Phase 2 Design](docs/phase-2-design.md)
- [Phase 3 Design](docs/phase-3-design.md)
- [Phase 4 Design](docs/phase-4-design.md)
- [Phase 7 Design](docs/phase-7-design.md)
- [Phase 8 Design](docs/phase-8-design.md)
- [Release Readiness](docs/release-readiness-design.md)
- [Analytics API OpenAPI Contract](docs/analytics-api.openapi.json)

项目协作规则见 [AGENTS.md](AGENTS.md)。CI 使用与本地相同的统一脚本，并额外验证 Docker Compose 配置。

Phase 3 PR1 contract 可以通过以下命令验证：

```bash
pnpm analytics:contract:validate
```

Phase 3 API contract 区分无日期的站点累计 Overview，以及必须提供 `from/to` 的 Reports API；详见 [Analytics API OpenAPI Contract](docs/analytics-api.openapi.json)。

启动完整的 Phase 3 processing workflow：

```bash
pnpm docker:processing
```

Analytics API 在 `http://localhost:4002` 提供查询接口；Processor 处理 Raw Events 后可查询 Overview、Timeline 和 Top Pages。

验证完整的 Phase 3 链路：

```bash
pnpm e2e:analytics
```

该命令使用独立 Compose project 和测试端口，不删除现有 PostgreSQL volume。

验证包含 Dashboard 的完整 Phase 4 链路：

```bash
pnpm playwright:install
pnpm e2e:dashboard
```

Phase 3 PostgreSQL Storage 需要先启动 storage profile 并执行 migration：

```bash
docker compose --profile storage up -d --wait postgres
export DATABASE_URL=postgres://analytics:analytics@localhost:5432/analytics
pnpm db:migrate
pnpm test:migrations
pnpm test:integration
```

`pnpm test:migrations` 需要 PostgreSQL、`psql` 和 `CREATEDB` 权限，会验证首次/重复 migration、
旧 history 升级、history/checksum 以及核心 schema。升级验证使用独立临时数据库，
完成后自动删除。Analytics E2E 使用独立 Compose project 和
测试 volume；失败诊断写入 `artifacts/analytics-e2e/`，不会删除现有开发数据库
volume。Dashboard E2E 的截图、trace 和 Compose 诊断写入
`artifacts/dashboard-e2e/`。

## 技术方向

```text
Client / Dashboard   TypeScript、React、Next.js、pnpm
Backend              Rust（Backend 阶段引入）
Storage              PostgreSQL（Storage 阶段引入）
Development          Docker、Docker Compose
Protocol             JSON Schema、JSON / HTTP
```

## 设计原则

- Client SDK 不依赖具体 Framework 或 Router。
- Router Adapter 只负责观察导航。
- Client 与 Backend 通过版本化 Event Protocol 通信。
- Dashboard 不直接访问数据库。
- 模块按阶段、线性创建。
- 优先完成可运行的核心 Workflow，再逐步增加复杂能力。

## License

本项目使用 [MIT License](LICENSE)。
