# Phase 0 Design — Project Foundation

> Status: Completed
> Scope: Monorepo foundation, Event Protocol V1, Next.js Router Playground, Docker development environment

## 1. Phase 0 定义

Phase 0 是正式开发前的项目启动阶段，目标不是实现 Analytics 功能，而是建立一个可以持续开发和验证的工程基础。

Phase 0 完成后，项目应该具备：

```text
稳定的 TypeScript Monorepo 基础
        +
可复现的 Next.js Router Playground
        +
初版 Event Protocol
        +
统一的本地开发环境
        +
清晰的后续 Client SDK 开发入口
```

## 2. 目标

### 2.1 必须达成

- 建立 pnpm TypeScript workspace。
- 建立清晰、可逐步扩展的 Monorepo 目录。
- 创建 Next.js App Router Playground，复现常见导航行为。
- 设计 Event Protocol V1 的基础结构。
- 准备 Protocol Schema、examples 和 fixtures。
- 建立 Docker / Docker Compose 开发环境。
- 固定 Node.js、pnpm 和 Next.js 开发环境版本。
- 提供统一的启动、检查和测试脚本入口。
- 为 Phase 1 的 `NavigationObserver` 和 Client SDK 提供明确的实现依据。

### 2.2 不属于本阶段

- 不创建或实现 `analytics-core`。
- 不创建或实现正式 `observer-next`。
- 不创建 Collector、Processor、Storage、Analytics API 或 Dashboard。
- 不建立 Rust workspace、Cargo workspace 或 Rust toolchain。
- 不接收或发送真实 Analytics Event。
- 不连接生产站点。
- 不实现 Visitor、Session、聚合、查询或 Dashboard。
- 不实现 React Router、TanStack Router 等其他 Adapter。

## 3. 实施原则

### 3.1 线性开发

Phase 0 内部也按顺序推进：

```text
工程骨架
  → 开发环境
  → Router Playground
  → Observation Contract
  → Event Protocol V1
  → Fixture / Validation
  → 完成检查
```

### 3.2 不创建空模块

Phase 0 只创建它实际需要的目录和文件。后续业务模块在进入对应阶段时再创建：

```text
Client SDK
  → Backend Collector
  → Storage / Processor / Analytics API
  → Dashboard
```

### 3.3 Protocol 先于实现

Event Protocol 是 Client 和 Backend 未来共享的契约。Phase 0 只定义 V1，不提前实现完整的协议生成系统。

### 3.4 Playground 只观察，不统计

Router Playground 只用于复现 Next.js Router 行为，不包含：

- Analytics SDK
- Event Transport
- Page View 统计
- Session 逻辑
- 数据库

## 4. Phase 0 最终目录

```text
web-analytics-platform/
├── examples/
│   └── nextjs-router-playground/
├── protocol/
│   ├── schemas/
│   ├── examples/
│   └── fixtures/
├── scripts/
│   ├── dev.sh
│   ├── check.sh
│   ├── test.sh
│   ├── build.sh
│   ├── format.sh
│   ├── format-check.sh
│   ├── docker-dev.sh
│   └── validate-protocol.mjs
├── docker/
│   ├── nextjs-router-playground.Dockerfile
│   └── README.md
├── docs/
│   ├── decisions/
│   ├── getting-started.md
│   ├── event-protocol.md
│   ├── router-playground.md
│   └── phase-0-design.md
├── .github/
│   └── workflows/ci.yml
├── compose.yaml
├── .env.example
├── .dockerignore
├── .node-version
├── package.json
├── pnpm-workspace.yaml
├── README.md
└── AGENTS.md
```

Phase 0 不创建：

```text
apps/dashboard/
packages/analytics-core/
packages/observer-core/
packages/observer-next/
services/
crates/
Cargo.toml
rust-toolchain.toml
```

## 5. 工作步骤

## Step 1 — 检查基础环境

确认开发环境可以使用：

```text
Git
Node.js
pnpm
Docker
Docker Compose
```

需要记录最低版本要求，并选择一种版本管理方式：

```text
.node-version
```

或者等价的版本管理文件。

Checklist：

- [x] Node.js 最低版本已确定。
- [x] pnpm 版本已确定。
- [x] Docker Desktop / Docker Engine 要求已记录。
- [x] Compose 命令格式已确认使用 `docker compose`。
- [x] 版本要求已写入 README。

## Step 2 — 创建 pnpm Monorepo

创建根配置：

```json
{
  "private": true,
  "packageManager": "pnpm@<version>"
}
```

`pnpm-workspace.yaml` 初始只包含实际存在的 workspace：

```yaml
packages:
  - "examples/*"
```

后续进入 Client SDK 阶段后再加入：

```yaml
packages:
  - "examples/*"
  - "packages/*"
```

Checklist：

- [x] 根 `package.json` 已创建。
- [x] `pnpm-workspace.yaml` 已创建。
- [x] workspace 不包含不存在的目录。
- [x] `pnpm install` 可以完成。
- [x] Node / pnpm 版本命令可复现。

## Step 3 — 创建 Next.js Router Playground

创建：

```text
examples/nextjs-router-playground/
```

使用 Next.js App Router，包含最小页面：

```text
/
/about
/products/[slug]
/search
/nested
/nested/child
```

页面中提供导航入口：

```text
<Link>
router.push()
router.replace()
back()
forward()
```

Playground 应显示当前状态：

```text
window.location.href
pathname
search params
hash
document.title
```

可以添加一个仅用于调试的 navigation log：

```text
timestamp
previous URL
current URL
observed change
```

这个 log 不是最终 Observer 实现，只用于人工确认 Router 行为。

Checklist：

- [x] 首次打开 `/` 可以正常渲染。
- [x] `<Link>` 可以触发客户端导航。
- [x] `router.push()` 可以触发客户端导航。
- [x] `router.replace()` 可以触发客户端导航。
- [x] 浏览器 back / forward 可以工作。
- [x] 动态路由可以工作。
- [x] pathname 变化可以观察。
- [x] search params 变化可以观察。
- [x] hash 变化的行为已记录。
- [x] 嵌套路由和共享 layout 可以工作。
- [x] Playground 可以在 host 和 Docker 环境运行。

## Step 4 — 确定 Navigation Observation Contract

Phase 0 只定义契约，不创建 `observer-core` package。

建议契约：

```ts
export type NavigationType = "initial" | "push" | "replace" | "pop" | "unknown";

export interface NavigationEvent {
  url: string;
  path: string;
  title?: string;
  referrer?: string;
  navigationType: NavigationType;
  occurredAt: number;
}

export interface NavigationObserver {
  subscribe(listener: (event: NavigationEvent) => void): () => void;
}
```

需要记录的设计决策：

- initial 是否由 Adapter 产生。
- search params 变化是否属于导航事件。
- hash 变化是否属于 Page View。
- 如何表示无法识别的导航类型。
- unsubscribe 是否必须安全调用多次。
- 是否允许多个 listener。
- `route_pattern` 是否可选。

Phase 0 推荐默认规则：

```text
initial：是
pathname 变化：是
search params 变化：是
hash 变化：先记录，不默认计为 Page View
route_pattern：可选
```

Checklist：

- [x] 接口与 Analytics Core 无关。
- [x] 接口不依赖 Next.js 或 React Router 类型。
- [x] Playground 中的场景都能映射到接口。
- [x] 事件字段的必填性已确定。
- [x] hash 行为已有明确决定。

## Step 5 — 设计 Event Protocol V1（历史目录结构）

> 本节记录启动阶段的历史设计。Phase 7 PR0 已将开发期 V1/V2 合并为唯一初始协议；当前目录使用 `protocol/events/schemas`、`examples` 和 `fixtures`。

创建：

```text
protocol/events/schemas/
protocol/events/examples/
protocol/events/fixtures/
```

第一版只定义 Page View 相关协议：

```text
BaseEvent
PageViewEvent
EventBatch
```

建议的基础事件：

```json
{
  "schema_version": 1,
  "event_id": "01H...",
  "type": "page_view",
  "site_id": "site_example",
  "occurred_at": 1760000000000,
  "url": "https://example.com/about",
  "path": "/about",
  "title": "About",
  "referrer": "https://google.com/",
  "context": {}
}
```

Protocol V1 需要确定：

- snake_case 还是 camelCase。
- `occurred_at` 使用 Unix milliseconds 还是 ISO timestamp。
- `event_id` 的格式和长度限制。
- `site_id` 的格式和长度限制。
- `url`、`path`、`title`、`referrer` 的最大长度。
- 可选字段缺失时的行为。
- 未知字段是否允许。
- EventBatch 的最大事件数量。
- Schema version 的兼容策略。

建议默认规则：

```text
字段使用 snake_case
occurred_at 使用 Unix milliseconds
event_id 由客户端生成
Page View 是第一版唯一正式事件
未知字段允许但不参与统计
Custom Event 留到后续阶段
```

Checklist：

- [x] JSON Schema 已创建。
- [x] Page View example 已创建。
- [x] EventBatch example 已创建。
- [x] 合法 fixture 已创建。
- [x] 非法 fixture 已创建。
- [x] 字段限制已记录。
- [x] V1 兼容规则已记录。

## Step 6 — 配置 Docker / Docker Compose

Phase 0 的 Docker 支持以开发环境为目标，不是生产部署方案。

建议内容：

```text
docker/nextjs-router-playground.Dockerfile
compose.yaml
.env.example
.dockerignore
```

Phase 0 的 Compose 服务：

```text
router-playground
```

PostgreSQL 可以放在 `storage` profile 中，供后续阶段启用：

```text
default  Router Playground
storage  PostgreSQL
```

Phase 0 不添加：

```text
collector
processor
analytics-api
dashboard
```

Checklist：

- [x] `docker compose config` 可以通过。
- [x] 默认 profile 可以启动 Playground。
- [x] `storage` profile 已明确延后到 Storage 阶段。
- [x] 端口和环境变量有明确约定。
- [x] secrets 不写入镜像或提交文件。
- [x] Docker volume 行为已记录。
- [x] Playground 支持开发模式 hot reload，或有明确替代方案。
- [x] host 启动方式和 Docker 启动方式都已记录。

## Step 7 — 建立统一脚本

Phase 0 只要求脚本能够处理已经存在的项目内容。

### `scripts/dev.sh`

启动 Router Playground 和基础开发环境。

### `scripts/check.sh`

执行：

```text
workspace 检查
Protocol Schema 检查
Markdown / 配置文件基础检查
```

不执行 Rust 检查，因为 Phase 0 没有 Rust workspace。

### `scripts/test.sh`

执行 Playground 相关测试和 Protocol fixture validation。

### `scripts/build.sh`

构建 Phase 0 已存在的 Next.js Playground。

Checklist：

- [x] 脚本具有可执行权限。
- [x] 脚本失败时返回非零退出码。
- [x] 脚本不依赖未创建的后端模块。
- [x] 脚本在 host 环境可执行。
- [x] 脚本与 Docker 开发方式的职责已区分。
- [x] CI 可以复用 `check.sh` 和 `test.sh`。
- [x] `pnpm format` 可以格式化项目文件。
- [x] `pnpm format:check` 可以检查格式和 trailing newline。
- [x] `pnpm check` 包含格式检查、import 排序和空行规则。

## Step 8 — 编写启动文档和决策记录

已创建：

```text
docs/getting-started.md
docs/event-protocol.md
docs/router-playground.md
docs/decisions/ADR-001-monorepo.md
docs/decisions/ADR-002-nextjs-app-router-first.md
```

至少说明：

- 如何安装 Node / pnpm。
- 如何启动 Playground。
- 如何使用 Docker Compose。
- 如何运行 Protocol validation。
- 如何添加新的 Router 场景。
- Phase 0 为什么不建立 Rust workspace。
- Phase 1 从哪里开始。

Checklist：

- [x] 新开发者无需阅读聊天记录即可启动项目。
- [x] Host 和 Docker 两种启动方式都有说明。
- [x] Phase 0 的非目标已记录。
- [x] 关键架构决策有 ADR。
- [x] 后续工作入口已链接到 roadmap。

## 6. Phase 0 验收清单

### 工程基础

- [x] 项目可以通过 pnpm 安装。
- [x] workspace 只包含实际存在的 TypeScript 项目。
- [x] Node / pnpm 版本可复现。
- [x] 没有空的 Client、Backend、Storage 或 Dashboard package。
- [x] 没有 Cargo workspace 或 Rust 启动依赖。

### Router Playground

- [x] Next.js App Router 可以启动。
- [x] 常见导航操作可以复现。
- [x] 动态路由、嵌套路由和 query 场景可以复现。
- [x] 导航行为和预期结果有记录。

### Protocol

- [x] PageViewEvent Schema 存在。
- [x] EventBatch Schema 存在。
- [x] 合法和非法 examples / fixtures 存在。
- [x] Observation Contract 和 Event Protocol 的边界清楚。
- [x] Protocol V1 没有依赖 TypeScript 或 Rust 私有类型。

### Docker

- [x] 默认 Compose 环境可以启动。
- [x] Router Playground 可以在 Docker 中运行。
- [x] PostgreSQL profile 已明确延后到 Storage 阶段。
- [x] 环境变量模板存在。

### 自动化

- [x] `./scripts/check.sh` 成功。
- [x] `./scripts/test.sh` 成功。
- [x] `./scripts/build.sh` 成功。
- [x] Protocol fixtures 可以通过自动校验。
- [x] 基础 CI 可以复用这些脚本。

## 7. Phase 0 退出条件

满足以下条件后，才进入 Phase 1：

```text
工程可以重复启动
Router 场景已经被观察和记录
Event Protocol V1 已确定
Protocol fixture 可以自动验证
开发脚本可以运行
没有提前创建空业务模块
```

Phase 1 的第一项工作是创建基础 Client SDK packages：

```text
packages/protocol-ts/
packages/observer-core/
packages/analytics-core/
```

其余 package 按 Phase 1 的后续 PR 线性创建：

```text
observer-next
  → analytics-browser
  → transport
```

并将 Router Playground 接入真实的 `observer-next` 测试流程。

## 8. Phase 0 之后允许变化的内容

Phase 0 的目标是形成可工作的基础，不要求所有细节永久冻结。以下内容可以在 Phase 1 根据真实观察结果调整：

- `NavigationEvent` 的可选字段。
- hash 是否计为 Page View。
- Next.js Adapter 的组件或 Hook 形式。
- Protocol 中浏览器 context 的具体结构。
- Compose 的 service 名称和 profile 细节。

但以下边界不应随意改变：

- Client SDK 不依赖具体 Router。
- Adapter 通过 Observer Contract 接入。
- Client / Backend 通过 Event Protocol 通信。
- 模块按阶段、线性创建。
