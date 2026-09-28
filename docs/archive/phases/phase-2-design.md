# Phase 2 Design — Backend Collector

> Historical implementation design: this document describes the pre-consolidation Event Protocol V1 and the initial TOML-based Collector configuration. After Phase 7 PR0, the unified protocol and capability configuration documents take precedence.

> Status: Completed historical implementation design
> Scope: HTTP ingestion, Event Protocol V1 validation, site configuration, Origin allowlist, Public Ingest Key provisioning and validation, basic rate limiting and FetchTransport integration

## 1. Phase 2 定义

Phase 2 在 Phase 0 的 Monorepo、Event Protocol V1 和 Phase 1 Client SDK 之上，建立第一个可以接收浏览器事件的 Backend Collector。

本阶段的首要目标是打通：

```text
Next.js Website
  → observer-next
  → analytics-browser
  → bounded Buffer
  → FetchTransport
  → Backend Collector
  → Event Protocol V1 validation
  → InMemory Event Sink
```

Phase 2 仍然采用线性实施方式。先确定 HTTP 契约，再建立 Rust 服务，再实现 ingestion 和安全控制，最后接入 Client FetchTransport。FetchTransport 只在显式配置后启用，默认开发 workflow 仍使用 MockTransport。

## 2. 必须达成

- 定义稳定的 Client → Collector HTTP API 契约。
- 建立最小 Rust workspace 和 Collector 服务。
- 提供 `GET /health` 健康检查。
- 提供 `POST /v1/events` EventBatch ingestion endpoint。
- 使用 Event Protocol V1 JSON Schema 校验请求。
- 根据 `site_id`、Origin 和 Ingest Key 解析并校验 site / environment 配置及 enabled 状态。
- 以 Origin allowlist 作为主要的访问管理手段。
- 以 Public Ingest Key 作为辅助的 site 级保护手段。
- 由 Backend 负责生成和管理 Public Ingest Key 的配置生命周期。
- 提供简单的内存限流，避免基础滥用。
- 提供可替换的 `EventSink`，首期使用 InMemory Sink。
- 提供结构化日志和明确的 HTTP 错误响应。
- 实现 Phase 1 `Transport` contract 对应的 FetchTransport。
- 完成 Client SDK → Collector 的开发环境 workflow。

## 3. 不属于本阶段

- PostgreSQL、数据库 migration 或持久化 Raw Event Store。
- Processor、Page View 聚合、Session 或 Visitor 计算。
- Analytics API 和 Dashboard。
- 服务端事件、Server SDK 或服务端请求采集。
- BeaconTransport 的卸载语义和可靠发送保证。
- 自动重试、离线队列、持久化 Buffer 或跨实例限流。
- 管理后台或 Site 管理 API。
- Custom Event、Web Vital、Error、Conversion 等事件类型。
- IP 持久化、Geo enrichment、指纹和跨设备识别。

## 4. 实施原则

### 4.1 Contract first

`protocol/` 中的 JSON Schema 仍然是事件结构的事实来源。HTTP API 只负责定义传输、认证、错误和接收语义，不复制或改变 Event Protocol 字段规则。

### 4.2 Collector 与统计解耦

Collector 只负责：

- 接收请求
- 认证和站点校验
- 请求大小和 batch 限制
- Protocol validation
- 将合法事件交给 Sink
- 返回明确结果

Collector 不计算 Page View、Session、Visitor 或聚合指标。

### 4.3 先使用可替换的 InMemory Sink

HTTP 层依赖 `EventSink` 抽象，而不是具体数据库。InMemory Sink 只用于开发和测试，不承诺生产数据持久化。

后续 Storage 阶段可以实现 PostgreSQL Sink，而不改变 ingestion API。

### 4.4 安全控制分层

```text
Origin allowlist       主要管理手段
        ↓
site / environment     配置边界
        ↓
Public Ingest Key      辅助保护手段
        ↓
Rate limiting          基础滥用控制
```

Origin allowlist 是浏览器接入是否允许的主要判断。Ingest Key 是公开在客户端中的辅助标识，不能被当作秘密或唯一安全边界。

## 5. HTTP API Contract

### 5.0 `GET /health`

健康检查在 Collector 启动且配置加载成功后返回 `200 OK`：

```json
{
  "status": "ok"
}
```

配置无法加载或存在歧义时，Collector 启动失败，不返回可用状态。

### 5.1 `POST /v1/events`

请求：

```http
POST /v1/events HTTP/1.1
Content-Type: application/json
Origin: https://www.example.com
X-Ingest-Key: site-example-public-key
```

Body 必须是 Event Protocol V1 的 `EventBatch`：

```json
{
  "schema_version": 1,
  "events": [
    {
      "schema_version": 1,
      "event_id": "01J00000000000000000000000",
      "type": "page_view",
      "site_id": "site_example",
      "occurred_at": 1760000000000,
      "path": "/about"
    }
  ]
}
```

请求约束：

- `Content-Type` 必须为 `application/json`，允许附带 charset 参数；不支持的类型返回 `415 unsupported_media_type`。
- body 必须是合法 JSON。
- body 必须符合 EventBatch V1 Schema。
- batch 必须包含 1–100 条 PageViewEvent。
- body 最大为 64 KiB；超过限制返回 `413 payload_too_large`。
- 当前 batch 内的所有事件必须属于同一个允许的 site / environment。
- batch 采用原子接收：任意事件无效时，整批不进入 Sink。

EventBatch V1 不携带 `environment` 字段。Collector 通过 `site_id`、请求 Origin 和 Ingest Key 匹配服务端配置，从而确定唯一的 site / environment；不能由请求 body 覆盖或推断服务端 environment。

### 5.2 成功响应

初版使用 `202 Accepted`，表示 Collector 已完成校验并交给当前 Sink，不表示长期持久化完成：

```json
{
  "accepted": 1
}
```

成功响应不返回事件内容，也不要求 Client 依赖复杂 response body。

`accepted` 表示本次 batch 中实际交给 EventSink 的事件数量。Collector 只有在整批成功交给 Sink 后才返回 `202`。

### 5.3 错误响应

错误结构保持稳定：

```json
{
  "error": {
    "code": "invalid_event_batch",
    "message": "Event batch validation failed"
  }
}
```

初始错误映射：

| Status | Code                                      | 含义                               |
| ------ | ----------------------------------------- | ---------------------------------- |
| `400`  | `invalid_json` / `invalid_event_batch`    | JSON 或 Protocol V1 校验失败       |
| `401`  | `invalid_ingest_key`                      | Ingest Key 缺失或错误              |
| `403`  | `origin_not_allowed` / `site_not_allowed` | Origin、site 或 environment 不允许 |
| `415`  | `unsupported_media_type`                  | Content-Type 不是支持的 JSON 类型  |
| `413`  | `payload_too_large`                       | body 或 batch 超过限制             |
| `429`  | `rate_limited`                            | 超过基础限流阈值                   |
| `500`  | `collector_error`                         | Collector 或 Sink 内部错误         |

错误响应不返回 stack trace、完整 ingest key 或内部配置。

### 5.4 CORS 和 preflight

Collector 需要支持浏览器 Fetch：

- 对允许的 Origin 返回精确的 `Access-Control-Allow-Origin`，不默认使用 `*`。
- 支持 `OPTIONS /v1/events` preflight。
- 允许 `Content-Type` 和 `X-Ingest-Key` request headers。
- 明确允许的方法为 `POST`。
- preflight 成功返回 `204 No Content`。
- 返回 `Vary: Origin`，避免缓存不同 Origin 的 CORS 响应。
- `Access-Control-Max-Age` 固定为 `600` 秒。
- preflight 返回 `Access-Control-Allow-Methods: POST` 和 `Access-Control-Allow-Headers: Content-Type, X-Ingest-Key`。
- 不使用 credentials / cookie 认证。
- 未允许的 Origin 不得通过 CORS 响应头获得写入权限。

浏览器 POST 缺失 `Origin` 时返回 `403 origin_not_allowed`。具体 response headers 在 PR1 contract fixtures 中固定。

HTTP fixture 使用统一的 scenario JSON 结构，放在 `protocol/contracts/http-ingestion/v1/fixtures/`。每个 fixture 包含唯一 `id`、原始 request（包括字符串形式的 body）和 expected response；POST fixture 还包含 `setup.config`，需要特殊服务状态的 fixture 可以声明 `setup.rate_limit` 或 `setup.sink`。这样可以同时表达合法 JSON、非法 JSON、边界 payload 和可重放的安全/错误场景。`pnpm http:validate` 校验 fixture 结构和关键语义，不启动 Collector。

最终请求错误优先级固定为：Content-Type 检查 → body 大小检查 → JSON 解析 → batch/site 一致性检查 → site 配置检查 → Origin 检查 → Ingest Key 检查 → rate limit → 完整 Event Protocol Schema 校验 → EventSink。PR5 完成 Origin、CORS 和单进程限流；错误优先级和 CORS 行为由对应 fixtures 覆盖。

## 6. Site 与 Environment 配置

Phase 2 不创建管理 API，先使用 Collector 启动配置管理允许的站点：

```text
site_id
environment
enabled
allowed_origins[]
ingest_keys[]
```

`environment` 是服务端配置中的必填标签，不设置隐式默认值；首期推荐使用 `development`、`staging` 或 `production`。其值使用非空的配置标识，不进入 Event Protocol V1。

初版使用 TOML 配置文件加载，环境变量只负责指定配置文件路径，例如 `COLLECTOR_CONFIG=/etc/collector/config.toml`。配置结构必须能表达多个 site。

推荐逻辑：

```text
site_id + environment
  → site configuration
  → enabled check
  → origin check
  → required ingest key check
```

要求：

- `site_id` 必须与事件和配置匹配。
- 未知 site 拒绝。
- disabled site 拒绝。
- 无法唯一确定 environment 时拒绝。
- 不允许用请求 body 覆盖服务端配置。
- 每个 `site_id + environment` 必须至少有一个 key。
- 同一个 key 不能绑定多个 site/environment。
- 同一个 `site_id + Origin` 不能匹配多个 environment。
- 因此，同一 site 的不同 environment 必须使用互不重叠的 Origin；Collector 不支持通过共享 Origin 再由 key 在多个 environment 之间选择。
- 配置存在上述歧义时，Collector 必须在启动阶段失败。
- 配置错误应在启动阶段尽早失败，避免服务以不安全配置运行。

## 7. 安全策略

### 7.1 Origin allowlist

Origin allowlist 是主要的管理手段。每个 site / environment 独立维护允许的 Origin。

必须测试：

- 允许的 HTTPS Origin。
- 不允许的 Origin。
- localhost 开发 Origin。
- scheme、host、port 不同的 Origin。
- `Origin` 缺失。
- 多个 site 之间的 allowlist 隔离。
- preflight 与实际 POST 使用相同的 allowlist 判断。

不允许默认放宽为任意 Origin；开发环境也必须通过显式配置启用。

### 7.2 Public Ingest Key

Ingest Key 会被发送到浏览器，因此它不是 secret，也不能作为唯一的安全边界。它由 Backend 生成，绑定到 `site_id + environment`，再由 Website 以公开配置的形式使用。

URL 不用于推导 Ingest Key。Website 与 site 的关联通过 Collector 配置中的 Origin allowlist 完成。一个 site / environment 可以配置多个 Origin；Origin 使用完整的 `scheme + host + port` 匹配，不使用页面 path。

要求：

- 使用密码学安全随机数生成，建议生成 32 字节并使用 Base64URL 编码。
- 由 Backend CLI 或部署工具生成；Phase 2 不提供在线管理 API。
- Website 通过公开环境变量或等价的构建配置使用，不能在浏览器端生成。
- Key 与 site / environment 绑定。
- 缺失或不匹配时拒绝请求。
- 所有生产 site 都必须配置至少一个 key；不存在无 key 的生产模式。
- 日志中只记录脱敏后的 key 标识，不能记录完整值；key 比较使用恒定时间比较。
- Key 不能绕过 Origin allowlist。
- Phase 2 不实现自动 key rotation 或在线管理 API；通过多个有效 key 支持部署者执行手动轮换。

Phase 2 的配置字段使用 `ingest_keys: string[]`，允许多个 key 同时有效，为后续手动轮换保留空间。轮换流程、生成命令和 Website 配置方法见 [Ingest Key Guide](../../ingest-key.md)。

### 7.3 Rate limiting

限流只作为辅助滥用控制：

- 首期使用单进程内存限流。
- 初始按 `site_id + Origin` 维度限制请求次数，不按事件数量计数。
- 默认阈值为每分钟 600 个请求，窗口和阈值通过配置注入。
- 超限返回 `429` 和 `Retry-After`，单位为秒。
- 限流状态不持久化。
- 不承诺多实例之间的一致限流。
- 不把限流信息写入 Analytics Event。
- 限流策略和阈值通过配置注入，避免写死在 HTTP handler 中。

首期不为了精确统计引入额外协调组件。

## 8. Rust Backend 结构

Phase 2 开始建立 Rust workspace，因为 Backend 已经有实际服务内容：

```text
Cargo.toml
rust-toolchain.toml
services/
└── collector/
    ├── Cargo.toml
    └── src/
        ├── main.rs
        ├── config.rs
        ├── http.rs
        ├── validation.rs
        ├── security.rs
        └── sink.rs
```

首期不创建空的 `crates/`。只有出现可以独立复用和测试的领域模块时，才提取新的 crate。

建议技术选型：

| 能力              | 选型                               |
| ----------------- | ---------------------------------- |
| HTTP              | Axum                               |
| Runtime           | Tokio                              |
| JSON              | serde / serde_json                 |
| Schema validation | Rust JSON Schema 2020-12 validator |
| Logging           | tracing / tracing-subscriber       |
| Error             | thiserror / anyhow                 |
| CORS              | tower-http                         |

Rust validator 必须以 `protocol/events/` 和 `protocol/contexts/` 为输入来源，不能单独维护一套不一致的事件规则。

Collector 将 Event Protocol V1 的两个 schema 在编译时作为资源嵌入，并解析 schema `$ref`；运行时不依赖当前工作目录中的 schema 文件。Rust 测试同时遍历 `protocol/events/v1/fixtures/valid` 和 `protocol/events/v1/fixtures/invalid`，确保跨语言校验使用同一组 canonical fixtures。

## 9. FetchTransport

Backend API Contract 稳定后，在 Phase 2 后半段新增 `packages/transport/`：

```text
packages/transport/
├── src/
│   ├── fetch-transport.ts
│   └── index.ts
└── ...
```

建议接口：

```ts
export interface FetchTransportOptions {
  endpoint: string;
  ingestKey: string;
  fetch?: typeof globalThis.fetch;
}
```

`endpoint` 是完整的 `POST /v1/events` URL，不是 Collector base URL。FetchTransport 不发送空 batch；请求超时、HTTP 错误和 Collector 返回的 `error.code` 需要转换为可识别的 Transport error。Phase 2 不实现自动超时重试。

PR6 的 `FetchTransport` 使用 `Content-Type: application/json` 和 `X-Ingest-Key`，不手动设置 `Origin`。只有 `202 Accepted` 视为发送成功；`400`、`401`、`403`、`413`、`429` 和 `5xx` 转换为带有 `kind`、HTTP status、Collector error code 和 `Retry-After`（如果存在）的 `FetchTransportError`。Fetch 抛出的异常映射为 network error，Transport 不内置默认 timeout、不自动重试，也不持久化失败事件。

行为：

- 将 `PageViewEvent[]` 包装为 EventBatch。
- 发送 `Content-Type: application/json`。
- 按配置发送 `X-Ingest-Key`。
- `202` 视为成功。
- `400`、`401`、`403`、`413`、`429` 和 `5xx` 转换为可识别错误。
- 不自动重试。
- 不持久化失败事件。
- 不在 Transport 中实现业务统计或 Schema 规则。

BeaconTransport 不属于 Phase 2 必须内容，可在 SDK 稳定化阶段单独设计。

## 10. PR 划分

Phase 2 按以下顺序线性实施。

### PR1 — Backend API Contract

分支：`phase-2/pr1-backend-api-contract`

内容：

- 新增本设计文档的 API、错误、CORS 和安全契约。
- 固定成功和错误响应。
- 固定 batch / payload 边界、Content-Type、Origin 和 CORS 行为。
- 增加 HTTP request / response fixtures。
- 明确 site / environment 配置结构、key 必填和配置唯一性规则。

不创建 Rust 服务，不创建 `transport` package。

### PR2 — Rust Collector Foundation

分支：`phase-2/pr2-collector-foundation`

内容：

- 创建 Cargo workspace 和 `services/collector`。
- 实现配置加载、启动日志和 `GET /health`。
- 增加 Collector Docker 开发服务。
- 增加 Rust format、check 和 test 脚本。

不实现 ingestion、PostgreSQL 或复杂安全策略。

### PR3 — Event Ingestion and InMemory Sink

分支：`phase-2/pr3-event-ingestion`

内容：

- 实现 `POST /v1/events`。
- 实现 JSON、body size 和 EventBatch 校验。
- 使用 Protocol V1 Schema validation。
- 创建 `EventSink` contract 和 InMemory Sink。
- 返回 `202` 和稳定错误响应。
- 添加 request-level integration tests。

### PR4 — Ingest Key Provisioning and Validation

分支：`phase-2/pr4-ingest-key`

内容：

- 实现 Backend CLI 或等价的随机 key 生成能力。
- CLI 作为 Collector binary 的 `key generate` subcommand，不创建独立的 key 管理服务。
- 实现多 site / environment 配置和 `ingest_keys`。
- 实现 Public Ingest Key 校验。
- 实现 key 脱敏日志和配置启动校验。
- 添加正确、错误、缺失 key 的测试。
- `key generate` 使用 OS 安全随机源生成 32 字节 Base64URL key，只输出 stdout，不自动写入 TOML。

不实现在线 key 管理 API，不实现自动轮换。

PR4 的 key policy 在 Schema 校验前执行 site lookup、enabled 检查和恒定时间 key 比较；未知或 disabled site 返回 `403 site_not_allowed`，缺失或错误 key 返回 `401 invalid_ingest_key`。Origin、CORS 和 rate limit 明确留给 PR5。

### PR5 — Origin Allowlist, CORS and Rate Limit

分支：`phase-2/pr5-collector-security`

内容：

- 实现 Origin allowlist。
- 实现 CORS preflight。
- 实现单进程内存限流。
- 添加 Origin、CORS 和限流测试。

PR5 使用规范化后的 `scheme://host[:port]` 精确匹配 Origin；固定 `OPTIONS /v1/events` 成功响应为 `204`，CORS max-age 为 `600`。限流采用单进程 fixed window，按 `site_id + Origin` 每分钟 600 个请求计数，超限返回 `429` 和 `Retry-After: 60`。

### PR6 — FetchTransport and End-to-end Workflow

分支：`phase-2/pr6-fetch-transport-e2e`

内容：

- 创建 `packages/transport`。
- 实现 FetchTransport。
- 将 Playground 连接到可选 Collector。
- 保留默认 MockTransport 开发模式。
- 验证 Client SDK → Collector → InMemory Sink 完整 workflow。
- 增加跨 TypeScript / Rust 的 request fixtures。

不实现 BeaconTransport、数据库或自动重试。

## 11. 测试策略

### Contract tests

- 合法 EventBatch request。
- 非法 JSON。
- 缺少必填字段。
- 错误 `type`。
- 非法 `occurred_at`。
- 空 batch。
- 超过 100 条事件。
- oversized body。
- 不支持的 `Content-Type`。
- 未知字段允许。
- 不支持的 `schema_version`。
- 稳定错误 code 和 status。
- `202` 只在整批成功交给 Sink 后返回。

### Collector tests

- `/health` 成功。
- `/health` 返回 `200` 和 `{ "status": "ok" }`。
- 合法 batch 被 InMemory Sink 接收。
- 非法请求不会进入 Sink。
- site / environment 校验。
- Sink 错误返回 `500`。
- 多请求之间配置隔离。
- 无 PostgreSQL 时可以启动和测试。
- 配置歧义时启动失败。

### Security tests

- allowlisted Origin 通过。
- 非 allowlisted Origin 拒绝。
- 缺失 Origin 的处理符合契约。
- preflight 与 POST 判断一致。
- 正确 / 错误 / 缺失 Ingest Key。
- Key 不能绕过 allowlist。
- 超过阈值返回 `429`。
- `Retry-After` 格式正确。
- 限流状态仅存在于当前进程。

### FetchTransport tests

- request body 正确包装为 EventBatch。
- headers 正确。
- `202` 成功。
- 空 batch 不发送。
- 4xx / 5xx 错误映射。
- Collector error code 可以被读取。
- fetch 抛错。
- 不自动重试。
- 可注入 fetch，测试不依赖真实网络。

Playground 通过 `NEXT_PUBLIC_ANALYTICS_TRANSPORT` 显式选择 `mock` 或 `fetch`。默认值为 `mock`；启用 `fetch` 时必须同时配置完整 endpoint、ingest key 和 site id。

## 12. 工程与开发环境

Phase 2 应更新根脚本，使本地和 CI 保持一致：

```text
pnpm check
pnpm test
pnpm build
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
docker compose config
```

Docker Compose 初期新增 backend profile，Collector 默认监听 `:4001`：

```text
router-playground
collector
```

Collector 使用 `backend` profile；本地启动完整 Phase 2 workflow 使用：

```bash
pnpm docker:backend
```

该命令等价于：

```bash
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend up --build
```

它会等待 Collector 的 `/health` 检查通过后再启动 Playground。默认的 `pnpm docker:dev` 不加载 backend override，仍然只启动使用 MockTransport 的 Playground。

不加入 PostgreSQL。Collector 只使用配置和 InMemory Sink 即可运行。

需要更新：

- `README.md`
- `docs/getting-started.md`
- `docs/ingest-key.md`
- `.env.example`
- `docs/monorepo-design.md`
- `docs/roadmap.md`
- `AGENTS.md` 中的 Rust 命令约定
- Docker 开发说明

## 13. Phase 2 验收清单

### API 与 Protocol

- [x] HTTP API Contract 已固定。
- [x] 成功和错误响应 fixtures 已存在。
- [x] EventBatch V1 校验与 canonical Schema 一致。
- [x] batch、body 和 response 边界有测试。

### Collector

- [x] Rust workspace 建立。
- [x] Collector 可以启动。
- [x] `/health` 可用。
- [x] `POST /v1/events` 可用。
- [x] 合法事件进入 InMemory Sink。
- [x] 非法事件不会进入 Sink。
- [x] 不依赖 PostgreSQL。

PR3 已完成 HTTP ingestion、Protocol V1 Schema 校验和 InMemory Sink。PR4 完成 Site/Environment、Public Ingest Key 生成与校验；PR5 在其基础上完成 Origin、CORS 和单进程限流。

### Security

- [x] Site / environment 和 ingest key 配置校验完成。
- [x] Origin allowlist 完成。
- [x] CORS preflight 完成。
- [x] Public Ingest Key 生成、脱敏日志和请求校验完成。
- [x] 基础内存限流完成。
- [x] 安全日志不泄露完整 Key。

### Client Integration

- [x] FetchTransport 完成。
- [x] Collector endpoint 可配置。
- [x] Client SDK 可以发送 EventBatch。
- [x] 4xx、429、5xx 行为明确。
- [x] 不自动重试、不持久化失败事件。

### 工程

- [x] TypeScript 和 Rust 检查都接入统一流程。
- [x] Docker Compose 可同时启动 Playground 和 Collector。
- [x] Client → Collector integration workflow 可验证。
- [x] 不创建 PostgreSQL、Processor、Analytics API 或 Dashboard。

## 14. PR1 必须实现的契约项

以下契约必须在 PR1 的 fixtures 和文档中固定，不能留到 ingestion 实现时临时决定：

1. 成功响应使用 `202` 还是 `200`。本设计固定为 `202`。
2. 错误 response 的 JSON 结构和 error code。
3. body 最大大小和 batch 最大大小。本设计固定为 64 KiB 和 100 条。
4. site / environment 的配置格式和 environment 约束；本设计固定使用 TOML，environment 必填且不设置隐式默认值。
5. `Origin` 缺失时的处理；本设计固定返回 `403 origin_not_allowed`。
6. Ingest Key 使用的 header 名称和是否对所有 site 强制开启；本设计固定为 `X-Ingest-Key` 且必填。
7. 限流的初始维度、窗口和阈值；本设计固定按 `site_id + Origin` 每分钟 600 请求。
8. CORS 允许的 headers、methods、status、`Vary` 和 max-age。
9. InMemory Sink 的可观测方式和测试读取接口。
10. Collector 本地开发端口和 Compose service 名称；本设计固定为 `4001` 和 `collector`。

以下值已经作为 Phase 2 默认契约：64 KiB body、100 条 batch、`415` media type 错误、`204` preflight、600 秒 CORS max-age，以及 batch 原子接收。

Ingest Key 的生成方式、Website 使用方法、Origin 关联规则和手动轮换流程统一记录在 [Ingest Key Guide](../../ingest-key.md) 中，并由 PR4 实现和测试。

建议 PR1 输出 request / response fixtures，后续 Rust 和 TypeScript 都消费这些 fixtures，减少跨语言理解偏差。

## 15. Phase 2 退出条件

以下条件满足后进入 Phase 3：

```text
analytics-browser
  → FetchTransport
  → POST /v1/events
  → validation
  → security checks
  → InMemory Event Sink
  → 202 Accepted
```

并且：

- 合法 EventBatch 可以被 Collector 接收。
- 非法 Protocol、未知 site、未允许 Origin、错误 Key 和超限请求会被明确拒绝。
- CORS preflight 行为稳定。
- 基础限流可以阻止明显滥用，但不承诺跨实例一致性。
- FetchTransport 可以在不依赖真实网络的单元测试中验证。
- Client SDK 可以在 Docker Compose 中向 Collector 发送事件。
- Collector 日志和错误响应足够支持开发调试。
- InMemory Sink 仍然可替换为未来的 Storage Sink。
- 没有创建 PostgreSQL、Processor、Analytics API 或 Dashboard。

## 16. 后续允许调整的内容

以下内容可以根据真实 Backend 和 SDK 使用结果调整：

- FetchTransport 的详细错误分类。
- BeaconTransport 的实现和启用策略。
- 限流窗口、阈值和维度。
- Ingest Key 的自动 rotation 和在线管理 API。
- Site 管理配置的存储方式。
- InMemory Sink 到 PostgreSQL Sink 的接口细节。
- Collector 的部署方式和实例模型。

以下边界不应在 Phase 2 随意改变：

- Event Protocol V1 仍是跨语言事件契约。
- Origin allowlist 是浏览器接入的主要管理手段。
- Ingest Key 不是唯一安全边界。
- Collector 不负责统计聚合。
- Storage、Processor、Analytics API 和 Dashboard 延后到后续阶段。
- Phase 2 不持久化 IP，不建立 Visitor 或 Session 语义。
