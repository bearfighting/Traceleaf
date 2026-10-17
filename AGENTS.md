# Traceleaf 项目协作指南

## 项目目标

本项目第一阶段只实现浏览器端的 Web Navigation Analytics；导航观察使用框架无关的浏览器 Navigation API。

核心 Workflow：

```text
Website
  → Browser SDK
  → Navigation Observer
  → Event Protocol
  → Collector
  → PostgreSQL
  → Processor
  → Analytics API
  → Dashboard
```

目标是尽快得到一个可用、清晰、可扩展的端到端闭环，不追求第一阶段的绝对精确、实时一致性或大规模基础设施。

## 启动阶段和第一阶段范围

项目采用线性开发，不在启动阶段一次性创建所有模块。

启动阶段（Phase 0）只实现：

- Monorepo 基础骨架
- TypeScript / pnpm workspace 基础配置
- `protocol/` 目录
- Event Protocol V1 初稿、examples 和 fixtures
- `examples/nextjs-router-playground`，用于复现 Next.js App Router 常见导航行为
- Docker / Docker Compose 基础开发环境
- `.env.example`、`.dockerignore` 和 Node / pnpm 版本锁定

Rust / Cargo workspace、`rust-toolchain.toml` 和 `crates/` 不属于 Phase 0，等进入 Backend 阶段时再创建。

进入对应阶段后再创建和实现：

- `analytics-core`
- `analytics-browser`
- `observer-core`
- 通用 Navigation API observer
- 基础 HTTP / Beacon transport
- 使用已在 Phase 0 完成的 Event Protocol V1；不提前创建 Protocol TypeScript package
- Collector
- PostgreSQL raw event storage
- 基础 Processor
- Analytics Query API
- Dashboard：Page Views、Timeline、Top Pages

Router Playground 不属于 Analytics 模块，不实现正式 SDK、事件发送或统计逻辑；它们只用于验证同一个 Navigation API observer，不实现 Router 专用 adapter 或 bridge。

## Docker 开发环境

Docker Compose 是项目的统一本地环境基础。启动阶段只配置基础工具和 Router Playground；PostgreSQL、Collector、Processor、API 和 Dashboard 在进入对应阶段后再逐步加入 Compose。

使用 Compose profiles 区分阶段服务：

```text
default → storage → backend → processing → dashboard
```

开发时优先保证：

- 新环境可以通过统一命令启动。
- Node / pnpm、Rust 和 PostgreSQL 版本明确。
- 应用支持 hot reload。
- secrets 不进入代码、镜像或版本库。
- 本地 Compose 配置与 CI 的基础依赖保持一致。

模块创建顺序固定为：

```text
Client SDK → Backend Collector → Storage / Processor / API → Dashboard
```

浏览器端只采集可以直接获得的信息：

- URL / pathname
- Page title
- referrer
- UTM 参数
- language / timezone
- viewport / screen size
- user agent 派生的基础设备和浏览器信息

暂不实现：

- 服务端事件和 Server SDK
- React Router、TanStack Router 等其他 Adapter 的具体实现
- Conversion、Funnels、Replay、Heatmap、A/B Testing
- 精确地理位置、IP 持久化、指纹识别、跨设备识别
- 超出当前 MVP 的基础设施扩展和复杂实时处理
- 复杂迟到事件修正

## 不可破坏的架构边界

1. Analytics Core 和 Browser SDK 不依赖 Next.js、React Router 或其他具体 Router。
2. Navigation Observer 只观察浏览器提交的导航，不实现统计、Session 或 Transport 逻辑。
3. Client 与 Backend 通过版本化、language-neutral 的 Event Protocol 通信。
4. Collector 负责接收、基础校验和持久化，不承担复杂统计。
5. Processor 负责基础归一化和统计转换。
6. Dashboard 只能通过 Analytics API 查询，不能直接访问数据库。
7. Storage 通过接口与领域逻辑隔离；第一阶段只实现 PostgreSQL。
8. 安全策略必须可替换：Origin 白名单为主要控制手段，Public Ingest Key 和限流为辅助措施。

## Navigation Observer 契约

Browser SDK 使用浏览器 Navigation API 实现以下观察契约，不按 Router library 增加实现：

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

所有网站和 Router 共用通用 Navigation API observer，不创建 Router 专用 package 或 bridge。

`route_pattern` 是可选扩展字段；第一阶段至少保证 `path`、`url` 和 `title`。

## 后续 Analytics 默认语义

以下是计划中的 Analytics 目标语义，不代表 Phase 3 已经实现；Visitor 和 Session 的具体规则须在 Phase 5 先完成契约设计，再在 Phase 6 实现。

- 首次加载页面计为一次 Page View。
- pathname 或 search params 变化计为一次 Page View。
- push、replace、back、forward 都可以产生 Page View。
- 连续相同导航事件做简单去重。
- Visitor 使用站点范围内的匿名随机 ID。
- Session 采用简单 inactivity timeout；跨午夜按日期拆分。
- 数据允许存在秒级到几十秒延迟。
- 指标以趋势和整体使用分析为目标，不承诺审计级精确性。

## 开发规则

- 所有代码命名都必须表达稳定、具体的领域含义，包括文件和目录、模块、函数、类型、结构体、变量、常量、测试、脚本及其命令；禁止使用开发阶段、PR 编号、临时状态或含糊词语（如 `phase6`、`new`、`temp`、`legacy`）代替真实职责。确需表达兼容旧行为时，应说明兼容的对象和用途。协议/API 版本、数据库迁移编号、持久化标识及归档历史名称属于兼容性或历史记录，可按原样保留。
- 修改协议时同时更新 JSON Schema、TS 类型、Rust 类型、examples 和 fixtures。
- 新功能先添加端到端 Fixture，再实现各层代码。
- 不为了未来存储后端提前实现复杂通用抽象。
- 不提前创建没有实际实现内容的长期空 package。
- 不把安全策略散落在 HTTP Handler 中，使用独立 Policy / service 边界。
- 新增依赖前确认它是否真正服务于第一阶段 Workflow。
- 格式化、类型检查、测试和构建必须纳入统一脚本，并与 CI 使用相同命令。
- 发现架构决策变化时，在 `docs/decisions/` 添加 ADR，而不是只在代码中体现。

## 文档规则

- 新写或实质修改文档前，先核对当前实现、配置、脚本和 `docs/project-status.md`；明确区分已实现、已验证、计划中、暂缓和未验收事项，不把计划写成现状。
- `docs/project-status.md` 是未完成、计划中、暂缓和发布阻塞事项的唯一清单。其他文档可以保留设计理由、验收证据和历史记录，但不得维护互相独立的当前待办；需要保留详细验收项时，应在项目状态中列出或链接到唯一清单。
- 根 README 和独立 app、package、service、tool、protocol 的 README 使用互为对应的英文 `README.md` 与简体中文 `README.zh-CN.md`；两种语言都要完整表达相同的能力、要求、命令、端口和限制，不得用占位翻译代替。具体组件范围以[已归档的文档改进计划](docs/archive/documentation-improvement-plan.md)清单为准。
- 新设计文档、ADR、架构说明和技术规格以英文为规范版本。文档索引提供英文和简体中文版本并互相链接；面向中文操作人员的指南也提供简体中文版。归档记录、生成文件、schema、fixture 和内部 agent 指令不要求批量翻译。
- 在文档索引中按读者任务组织内容，并给每个设计或计划类链接标注生命周期：current reference、accepted decision、active proposal、completed record、superseded 或 historical。完成、取代或归档文档时同步修正索引和交叉链接；不要只移动文件而丢失权威信息。
- 文档中的命令、版本、端口、配置项、安全行为和发布状态必须能从当前仓库或明确的验收记录验证。新增 README、指南或计划时链接到相关权威文档，不复制会独立演变的事实或待办清单。
- 更改范围、决策或验收状态时，同步维护相关协议、README、指南、ADR、文档索引和项目状态；除非用户明确要求，否则不要重写或翻译无关历史文档。

Backend Foundation 阶段 Rust 约定：

- Rust toolchain 固定为 `1.98.1`，由 `rust-toolchain.toml` 管理。
- Rust workspace 命令通过统一脚本执行：`cargo fmt --check`、`cargo clippy --workspace --all-targets --all-features -- -D warnings`、`cargo test --workspace` 和 `cargo build --workspace`。
- Collector 默认监听 `0.0.0.0:4001`；Site policy 仅从 PostgreSQL 加载，监听地址和端口通过 CLI 参数配置。

## 完成定义

一个功能只有在以下内容都具备时才算完成：

- 代码实现
- 单元或集成测试
- 协议 / 文档更新
- 端到端 Workflow 可验证
- 错误和空数据状态可处理
