# Monorepo Design

## 设计目标

Monorepo 用于统一管理协议、Client SDK、Backend、Storage 和 Dashboard，同时保持各模块可以独立构建、测试、发布和部署。

Monorepo 不等于微服务拆分。第一阶段可以使用少量进程和一个 PostgreSQL，通过清晰的代码边界为未来拆分保留空间。

## 目标目录

```text
web-analytics-platform/
├── examples/
│   └── nextjs-router-playground/  # Phase 0 创建，作为 Adapter 测试目标
├── apps/
│   └── dashboard/                 # Dashboard 阶段创建
├── packages/                      # Client SDK 阶段创建
│   ├── protocol-ts/
│   ├── analytics-core/
│   ├── analytics-browser/
│   ├── observer-core/
│   ├── observer-next/
│   ├── transport/
│   └── query-client/              # Dashboard 阶段创建
├── services/                      # Backend / Storage 阶段创建
│   ├── collector/
│   ├── processor/
│   └── analytics-api/
├── crates/                        # Backend / Storage 阶段创建
│   ├── analytics-domain/
│   ├── analytics-protocol/
│   ├── analytics-storage/
│   └── storage-postgres/
├── protocol/
│   ├── events/                     # Stable event envelope contracts
│   │   ├── schemas/
│   │   ├── examples/
│   │   └── fixtures/
│   ├── contexts/                   # Stable nested context contracts
│   ├── contracts/                  # HTTP and Analytics API service contracts
│   └── scenarios/                  # Cross-service semantic scenarios
├── tests/
│   ├── integration/
│   └── e2e/
├── migrations/
├── tools/
│   └── db-migrator/                # Independent PostgreSQL migration runner
├── docker/
│   ├── nextjs-router-playground.Dockerfile
│   └── README.md
├── scripts/
├── docs/
│   └── decisions/
├── compose.yaml
├── .env.example
├── .dockerignore
├── .node-version
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

进入 Backend 阶段后再添加：

```text
Cargo.toml
rust-toolchain.toml
crates/
services/
```

当前 Backend Foundation 已创建 `services/collector` 和 `services/processor`，但尚未创建 `crates/`。Collector 使用 Rust 1.98.1、TOML 启动配置、Axum HTTP ingestion 和 PostgreSQL Sink；Processor 负责 Page View 聚合；Analytics API 仍按后续 PR 创建。

## 模块职责

### `packages/analytics-core`

Framework-agnostic 的 SDK 核心，负责 Event 构造、`beforeSend`、去重和 Transport contract。运行时 Buffer 属于 `analytics-browser`。

不得依赖 React、Next.js 或具体 Router。

### `packages/observer-core`

定义 `NavigationObserver`、`NavigationEvent` 和导航类型。

### `packages/observer-next`

第一阶段唯一实现的 Router Adapter，面向 Next.js App Router。只观察导航并转换为标准 `NavigationEvent`。

### `packages/analytics-browser`

浏览器上下文采集，以及有界内存 Buffer、flush 生命周期和可注入 Transport 的浏览器运行时。例如 URL、title、referrer、UTM、language、timezone、viewport 和基础 User-Agent 信息。

### `packages/transport`

实现 Fetch、Beacon、Batch 等传输策略。Analytics Core 只依赖 Transport 接口。

### `protocol/`

跨语言协议的事实来源，包括 JSON Schema、示例和测试 Fixture。

### `crates/analytics-domain`

Page View、Visitor、Session 等统计语义和领域模型。

### `services/collector`

接收、校验、Origin 白名单、Public Ingest Key、基础限流和 Raw Event 持久化。

### `services/processor`

读取 Raw Events，执行基础归一化、去重、Session 和聚合。

### `services/analytics-api`

向 Dashboard 提供 Overview、Timeline、Top Pages 等查询 API。

### `apps/dashboard`

只负责展示、过滤和日期范围选择，不直接访问数据库。

## 依赖规则

```text
observer-next     → observer-core
analytics-browser → analytics-core
analytics-browser → observer-core
analytics-browser → protocol-ts
transport         → analytics-core
collector         → protocol
processor         → analytics-domain + analytics-protocol + analytics-storage
analytics-api     → analytics-domain + analytics-storage
dashboard         → query-client
```

禁止：

```text
analytics-core → Next.js
analytics-core → React Router
dashboard      → PostgreSQL
collector      → dashboard
processor      → dashboard
```

## Workspace 策略

Phase 0 只建立 TypeScript workspace：

```text
pnpm workspace
```

Rust workspace 不属于 Phase 0。进入 Backend 阶段后再建立：

```text
Cargo workspace
```

Rust workspace 建立后，不要求一个工具完全理解两种语言。跨语言操作由 `scripts/` 统一编排：

```text
scripts/dev.sh
scripts/check.sh
scripts/test.sh
scripts/build.sh
scripts/generate-protocol.sh
```

## Protocol 管理

推荐流程：

```text
protocol/events/*/schemas/*.json
  → TypeScript types
  → Rust types
  → validation tests
```

任何 Protocol 修改必须同时更新：

- JSON Schema
- TypeScript 类型
- Rust 类型
- examples
- fixtures
- 兼容性测试

## 创建策略

目录结构描述的是最终目标，不代表项目启动时要一次性创建全部目录和 package。整个项目线性推进，每进入一个模块阶段才创建对应的实际代码。

Phase 0 项目启动阶段只创建：

```text
protocol
examples/nextjs-router-playground
pnpm workspace 基础文件
scripts 基础入口
```

进入 Phase 1 后，按照实际实施的 PR 线性创建 `packages/` 下的 package。当前已创建：

```text
packages/protocol-ts/
packages/observer-core/
packages/analytics-core/
packages/observer-next/
packages/analytics-browser/
```

后续的 `transport` 只在 Backend API 契约确定后添加，避免长期保留空模块。当前 Buffer 属于 `analytics-browser`，不创建空的 `transport` package。

Phase 1 的 package 创建顺序是：`protocol-ts`、`observer-core`、`analytics-core`、`observer-next`、`analytics-browser`，具体 Transport 实现延后到后续 PR。

Phase 0 不创建 Cargo workspace 基础文件。进入 Backend 阶段后，再根据 Backend 的实际实现需要添加 `Cargo.toml`、`rust-toolchain.toml` 和 `crates/`。

后续模块创建顺序：

```text
Client SDK
  → Backend Collector
  → Storage / Processor / Analytics API
  → Dashboard
```

其他 Router Adapter 只在实际实施对应功能时创建 package，不创建长期空 package。

## Next.js Router Playground

`examples/nextjs-router-playground` 是 Phase 0 的测试用 Next.js App Router 项目，不属于 Dashboard 或 Client SDK。

它只用于：

- 展示和复现常见 Next.js 导航行为。
- 验证 `NavigationObserver` 需要观察哪些变化。
- 为后续 `observer-next` 提供稳定的手工测试和 E2E 测试目标。

建议页面覆盖：

```text
/
/about
/products/[slug]
/search?q=...
/nested/child
```

建议操作覆盖：

```text
<Link>
router.push()
router.replace()
back()
forward()
pathname change
search params change
hash change
```

该项目可以输出简单的当前 URL、pathname、search params 和 navigation log，但不应包含事件发送、统计计算或正式 SDK 代码。它的作用是观察 Router，不是模拟完整业务网站。

## Docker 和 Docker Compose

Docker 是项目的统一开发环境基础，但不要求所有开发都必须在容器中完成。

Phase 0 提供：

- `compose.yaml`
- `.env.example`
- `.dockerignore`
- `.node-version` 或等价的 Node 版本锁定
- `rust-toolchain.toml` 或等价的 Rust toolchain 锁定（Backend 阶段加入）
- Node / pnpm 开发环境约定
- Rust toolchain 版本约定（Backend 阶段加入）
- Next.js Router Playground 的开发容器配置
- PostgreSQL 服务配置（按需要通过 profile 启用）

建议使用 Compose profiles，让服务按阶段逐步加入：

```text
default       基础开发工具和 Router Playground
storage       PostgreSQL
backend       Collector
processing    Processor
dashboard     Dashboard / Analytics API
```

示例：

```bash
docker compose up
docker compose --profile storage up
```

Phase 0 不创建 Collector、Processor 或 Dashboard 容器，只预留 Compose 的扩展方式。进入对应阶段时，再添加相应 service、Dockerfile 和环境变量。

容器化原则：

- 基础设施优先使用容器。
- 应用服务在开发阶段可以使用 host hot reload。
- 生产镜像和开发镜像分离。
- 不把 secrets 写入镜像或 Compose 文件。
- 所有服务通过环境变量配置端口、数据库连接和 Endpoint。
- Compose 只负责本地开发，不作为生产部署方案。

## 本地运行

当对应阶段完成后，开发服务逐步增加：

```text
Dashboard      :3000
Collector      :4001
Analytics API  :4002
PostgreSQL     :5432
Processor      background process
```

应用服务优先由原生开发命令或对应开发容器启动，便于快速调试。基础设施和阶段性服务通过 Compose profiles 管理。

## 构建和测试

统一入口：

```text
./scripts/check.sh
```

至少包括：

- Protocol 校验
- TypeScript typecheck
- TypeScript tests
- Rust fmt / clippy / tests
- Integration tests
- E2E tests

本地和 CI 调用同一套脚本，确保环境行为一致。

## 未来拆分原则

只有当以下条件出现时，才考虑拆分独立仓库或独立服务：

- SDK 需要独立版本和独立发布周期。
- Collector、Processor 或 API 需要独立扩缩容。
- 团队边界已经稳定。
- Monorepo CI 成为实际瓶颈。

在此之前，Monorepo 是更适合快速迭代 Protocol、SDK 和 Backend 的组织方式。
