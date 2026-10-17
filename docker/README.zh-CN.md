# Docker 开发环境

[English](README.md) | [项目概览](../README.zh-CN.md)

仓库提供 Next.js、React Router 和 TanStack Router Playground、Collector、Processor、Analytics API 和 Dashboard 的开发容器。

在仓库根目录启动：

```bash
pnpm docker:dev
```

Playground 地址为 `http://localhost:3000`。可选择其他 Playground：

```bash
pnpm docker:dev --router react       # http://localhost:3101
pnpm docker:dev --router tanstack    # http://localhost:3102
pnpm docker:dev --router react --with-backend
```

封装命令只接受 `next`、`react` 和 `tanstack`。`--with-backend` 会在选定的 Playground profile 之外启用 `backend`、`storage` 和 `processing` profiles。Rust 服务默认运行在容器中。若要使用容器 PostgreSQL 并在主机运行 Rust 服务，可运行 `pnpm docker:processing --rust-runtime native` 或 `pnpm dev:up --rust-runtime native`。Native 模式需要锁定的 Rust 工具链和运营人员提供的 GeoIP 数据库 `./data/GeoLite2-Country.mmdb`，并复用仓库的 `target/debug` 构建产物。使用 `--rust-runtime container` 可显式选择默认模式。端口可通过 `PLAYGROUND_NEXT_PORT`、`PLAYGROUND_REACT_PORT` 和 `PLAYGROUND_TANSTACK_PORT` 覆盖。

Playground 默认使用 `MockTransport`。独立 Playground 或基础 Compose 配置可在 `.env` 设置以下 Browser SDK 值：

```env
NEXT_PUBLIC_ANALYTICS_TRANSPORT=fetch
NEXT_PUBLIC_ANALYTICS_ENDPOINT=http://localhost:4001/v1/events
NEXT_PUBLIC_ANALYTICS_INGEST_KEY=public-key-example
NEXT_PUBLIC_ANALYTICS_SITE_ID=site_example
```

这些 `NEXT_PUBLIC_ANALYTICS_*` 值只配置浏览器 SDK；它们不会创建 Site，也不会初始化数据库策略。`pnpm docker:backend` 开发入口会加载 `compose.dev.yaml`，SDK key 来自 `LOCAL_DEV_INGEST_KEY`，Playground 固定使用 `site_example`。在 `.env` 设置 `LOCAL_DEV_INGEST_KEY`，并显式初始化该 Site：

```bash
pnpm docker:backend --seed-init
```

普通启动不会执行 seed。seed 和 Playground SDK 使用同一个 `LOCAL_DEV_INGEST_KEY`；该值缺失或为空时，显式 seed 会失败。示例值仅供本地开发。

手动配置 Site 时，可通过 backend profile 启动 Collector：

```bash
docker compose --profile backend up --build collector
```

若要等 Collector 健康后再启动 Playground，使用 backend Compose override：

```bash
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend up --build
```

同一工作流也可通过以下命令启动：

```bash
pnpm docker:backend
```

默认的 `pnpm docker:dev` 不加载此 override；它让 Playground 使用 MockTransport，因此不需要 Collector。

独立的 `db-migrate` 服务会在 Collector、Processor 和 Analytics API 之前运行 PostgreSQL migration。服务使用数据库 schema，但启动时不运行迁移。Collector 地址为 `http://localhost:4001`，提供 `GET /health`、`POST /v1/events` 和 `/v1/events` 的 CORS preflight。POST 请求必须同时具有 allowlist 中的 `Origin` 和已配置的 `X-Ingest-Key`；PostgreSQL 工作流会将接受的事件写入 `raw_events`。每个 `site_id + Origin` 每分钟最多 600 个请求。

使用以下命令启动 PostgreSQL 支持的 Collector、Processor 和 Analytics API 工作流：

```bash
pnpm docker:processing
```

Analytics API 地址为 `http://localhost:4002`，其 endpoint 包括 `/health`、站点全时段 Overview 和日期范围报表。报表查询读取 PostgreSQL 中处理后的事实表和聚合数据；站点管理操作也会使用 PostgreSQL 配置数据。

使用以下命令在 processing 工作流旁启动 Dashboard：

```bash
docker compose \
  --profile backend \
  --profile storage \
  --profile processing \
  --profile dashboard \
  up --build --wait
```

Dashboard 地址为 `http://localhost:13000/dashboard`。其服务端查询 client 使用 `http://analytics-api:4002`；Dashboard 服务没有 PostgreSQL 连接。

使用隔离的 E2E Compose 项目运行完整 Analytics 工作流：

```bash
pnpm e2e:analytics
```

E2E harness 使用端口 `14001`、`14002` 和 `15432`，不会删除已有 PostgreSQL volume。

运行完整 Dashboard 浏览器工作流前，先安装一次 Chromium：

```bash
pnpm playwright:install
pnpm e2e:dashboard
```

生成 key 时不会修改 TOML 配置：

```bash
cargo run -p collector -- key generate --site site_example --environment production
```

发送本地事件前，将输出添加到对应的 `ingest_keys` 条目，并在 `allowed_origins` 中配置 Website Origin。CORS preflight 返回 `204`；被限流的请求返回 `429` 和 `Retry-After: 60`。

Rust 服务共用 `docker/rust-workspace.Dockerfile`：Cargo manifests 和 lockfile 在同一个依赖层准备；Compose 选择服务开发 target；release target 将锁定 Rust builder 构建的二进制复制到精简 runtime image。Compose 挂载源代码，并用命名 volume 保存 `/workspace/target`，以便容器增量编译。Router Playground image 会在启动 Playground 前构建 workspace packages，包括所选 adapter facade、`analytics-browser`、transport 和共享 playground support。Playground 源码变更会 hot reload；修改 package 源码后需重启容器以重新构建 package。无论开发 Rust runtime 设置如何，E2E 都使用隔离的容器 runtime。

完整配置和命令说明另见 [Docker Development](README.md)、[Getting Started](../docs/getting-started.md)和[运维指南](../docs/operations.md)。
