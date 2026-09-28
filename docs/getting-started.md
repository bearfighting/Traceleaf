# Getting Started

## Requirements

- Node.js 26.10.0
- pnpm 12.6.0
- Rust 1.98.1 with Cargo

Phase 0 和 Phase 1 不需要 Rust、Cargo、PostgreSQL 或其他后端依赖。Phase 2 Collector 需要 Rust；Phase 3 Storage 需要 Docker 和 PostgreSQL。

## Install

在仓库根目录执行：

```bash
pnpm install
```

## Configure Geo country lookup

The backend profile requires an operator-supplied local MMDB. Supported sources are MaxMind GeoLite2 Country and DB-IP City Lite; both are read only for ISO country code lookup. Place the selected database at `./data/GeoLite2-Country.mmdb`, mounted read-only into Collector. The database filename does not select the provider; Collector checks the MMDB type and records the provider and build epoch. Compose never downloads a dataset, and Collector fails startup if the file is absent, unreadable, corrupt, or unsupported.

Set `GEOIP_TRUSTED_PROXIES` to a comma-separated list of proxy CIDRs only when Collector is behind known proxies. Forwarded client IPs are ignored by default.

### Offline Geo database update

MaxMind GeoLite2 Country requires an authorized account and use under the [GeoLite End User License Agreement](https://www.maxmind.com/en/geolite/eula). MaxMind attribution must credit **MaxMind, available from [https://www.maxmind.com](https://www.maxmind.com)**; superseded database copies must be destroyed within 30 days. See [MaxMind update guidance](https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases).

DB-IP City Lite is distributed under [CC BY 4.0](https://db-ip.com/db/download/ip-to-city-lite). A web application must include a link to DB-IP on pages that display or use its results. The Geo report conditionally displays **IP geolocation by DB-IP** when its selected date range contains DB-IP-derived data. Follow DB-IP's release guidance and record the release/build epoch and official checksum for each file.

For each operator-managed update:

1. Obtain the dataset from the provider under its license. Record provider, release/build epoch and the provider's published checksum. Do not commit the database or place it in CI artifacts.
2. Verify the published checksum and inspect MMDB metadata. Accept only `GeoLite2-Country` or `DBIP-City-Lite`; reject corrupt files, mismatched checksums and other database types.
3. As a post-launch operational check, mount the candidate in staging at `GEOIP_DATABASE_PATH`, restart Collector, and send controlled synthetic requests through the configured trusted-proxy path. Confirm country and `unknown` results. This staging exercise is not an MVP completion gate. Never use a real visitor IP as a test value or log it.
4. Keep a restricted, short-lived rollback copy. Copy the candidate to a temporary file on the same filesystem, verify it again, then atomically replace `./data/GeoLite2-Country.mmdb`. Restart Collector and check health and a synthetic country report before promotion.
5. If validation fails, restore the verified previous file atomically and restart Collector. Securely delete superseded licensed copies according to the relevant provider license and retention terms.
6. Record the new provider, build epoch, checksum, deployment time and smoke-test result. Record only aggregate coverage metrics; never record IP addresses.

For both providers, an individual unmapped or invalid address becomes `unknown`. Historical enrichment retains only the country code and source metadata; changing the dataset does not re-resolve historical requests.

If the file is absent, unreadable, corrupt, or has an unsupported database type, Collector startup fails closed; restore a verified file before restarting. If an individual address has no country record or cannot be parsed, the event is enriched as `unknown`.

## Run the Playground

```bash
pnpm dev
```

默认访问：

```text
http://localhost:3000
```

当前 Playground 提供常见 Next.js App Router 导航场景和 Navigation Debug Panel。

Phase 7 PR2.5 提供统一的 Router playground 选择入口。默认仍启动 Next playground：

```bash
pnpm dev --router next
pnpm dev --router react
pnpm dev --router tanstack
```

对应的 Docker Compose 目标用法如下：

```bash
pnpm docker:dev --router react
pnpm docker:dev --router tanstack --with-backend
```

`next`、`react` 和 `tanstack` 是固定 allowlist；未知 Router 参数会返回错误，不会启动 playground。

可测试页面：

```text
/
/about
/products/example
/search?q=test
/nested
/nested/child
```

可测试操作：

```text
<Link>
router.push()
router.replace()
router.back()
router.forward()
search params
hash
```

## Run the Dashboard

Phase 4 的 Dashboard 运行在独立的 Next.js app 中，已接入 Overview、Timeline、Top Pages、站点选择和日期范围查询。Dashboard 只通过服务端 Query Client 请求 Analytics API。

```bash
DASHBOARD_SITES=site_playground,site_alpha \
DASHBOARD_DEFAULT_SITE=site_playground \
ANALYTICS_API_URL=http://localhost:4002 \
pnpm --filter @web-analytics/dashboard dev
```

默认访问：

```text
http://localhost:3000/dashboard
```

Dashboard 支持以下 URL 参数：

```text
/dashboard?site_id=site_playground&from=2026-09-01&to=2026-09-18
```

`DASHBOARD_SITES` 和 `DASHBOARD_DEFAULT_SITE` 必须配置且默认站点必须属于允许列表。`ANALYTICS_API_URL` 必须是绝对的 HTTP(S) URL，例如 `http://localhost:4002`。Dashboard 通过服务端 Query Client 请求 Overview、Timeline 和 Top Pages；页面不会直接从浏览器请求 Analytics API。

管理配置时，设置 `DASHBOARD_DEFAULT_ENVIRONMENT`（默认 `production`），并将 `DASHBOARD_CONFIG_ADMIN_TOKEN` 设置为 `CONFIG_ADMIN_TOKENS` 中的一把 deployment-admin token。配置入口为 `http://localhost:3000/dashboard/settings`；Dashboard 服务端 BFF 使用该凭据调用受保护配置 API，浏览器不会获得 Admin token。生产部署还必须由可信反向代理保护 Dashboard 管理入口。

以 Compose 启动 Dashboard 和后端完整 workflow：

```bash
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend \
  --profile storage \
  --profile processing \
  --profile dashboard \
  up --build --wait
```

Dashboard 默认访问 `http://localhost:13000/dashboard`。它在容器内使用 `http://analytics-api:4002`，不需要数据库环境变量。

Protocol Consolidation 后，事件协议不需要额外的 site-level rollout flag。
Visitor、Session 和 Dimensions 由 Dashboard 的 Site capabilities 配置管理；
旧 `analytics_enabled` 仅保留用于迁移/回滚兼容，不再作为运行时开关。`protocol_v2_enabled`
已弃用且不会被 runtime 读取。

运行 Dashboard 浏览器 E2E 前安装 Chromium：

```bash
pnpm playwright:install
pnpm e2e:dashboard
```

配置管理跨层 E2E 使用隔离的 Compose 项目和数据卷，覆盖受保护配置写入、运行时版本收敛、存储故障恢复、站点隔离和 Dashboard 展示：

```bash
pnpm e2e:configuration
```

失败诊断保存在 `artifacts/configuration-e2e/`。`pnpm e2e:analytics`、`pnpm e2e:dashboard` 和 `pnpm e2e:configuration` 会清理各自的 Compose 项目和测试数据卷，同时保留按 workspace、依赖锁定内容和 E2E 套件隔离命名的 Docker 编译缓存卷；这样后续运行可以复用 Cargo target、Cargo registry、Node modules 和 Next.js 构建缓存。PostgreSQL 测试数据仍每次重建；Dashboard API-error 测试使用的临时 `.next` 卷会在测试结束后删除。缓存卷可用 `docker volume ls --filter name=web-analytics-e2e-` 查看；不再需要时按列出的具体卷名删除，避免清除其他项目的数据。Configuration E2E 默认使用 Dashboard `13100`、Collector `14101`、Analytics API `14102` 和 PostgreSQL `15433` 端口，可分别通过 `DASHBOARD_PORT`、`E2E_COLLECTOR_PORT`、`E2E_ANALYTICS_API_PORT`、`E2E_POSTGRES_PORT` 覆盖。

## Check

```bash
pnpm check
```

执行 Prettier 格式检查、TypeScript 类型检查和 ESLint。

## Format

```bash
pnpm format
```

使用 Prettier 格式化项目文件。格式规则包括统一缩进、引号、分号、trailing comma 和文件末尾 newline。

Import 顺序由 ESLint `import/order` 检查，代码边界的空行由 ESLint padding 规则检查。新增 workspace 时，应提供同名的 `format` 和 `format:check` scripts，使根目录命令自动覆盖它。

## Test

```bash
pnpm test
```

验证 Phase 3 Storage、Processor 和 Analytics API contract fixtures：

```bash
pnpm analytics:contract:validate
```

该命令校验 OpenAPI 3.1 JSON contract、canonical fixtures、Raw Event 语义、UTC 聚合结果和 API 响应结构。`/overview` 查询站点累计 Page Views；Reports API 使用 `/reports/{from}/{to}/...` 路径并限制为最多 366 天。PR1 提供 contract 和 fixtures；PR2 另外提供 PostgreSQL Storage 和 migration。

验证 Phase 2 HTTP contract fixtures：

```bash
pnpm http:validate
```

该命令检查 request/response fixture 的结构、状态码、header 格式、scenario ID、配置引用、边界 payload、CORS response 和 setup 状态，不启动 Collector。

命令会执行 Protocol 校验以及所有已创建 package 的单元测试。

`pnpm test` 同时校验 Event Protocol V1 的合法和非法 fixtures。

## PostgreSQL Storage

Compose uses PostgreSQL 18.6. The PostgreSQL 18 official image stores data under
`/var/lib/postgresql/18/docker`; this repository uses a new `postgres_data_v18`
volume so an existing PostgreSQL 17 volume is never opened by the new server.
Before switching an existing local database, make a custom-format backup while
its PostgreSQL 17 container is still running:

```bash
docker compose exec -T postgres pg_dump -U analytics -d analytics -Fc > analytics.pg_dump
```

After starting PostgreSQL 18, restore the data into the new database, then
apply any migrations introduced since the backup:

```bash
docker compose exec -T postgres pg_restore -U analytics -d analytics --clean --if-exists < analytics.pg_dump
```

Keep the backup outside version control and remove it after confirming the
restore. The old named volume remains available for rollback; do not attach it
to the PostgreSQL 18 container.

Configuration documents, environment policies, Ingest Key digests, Conversion/Funnel definitions, and configuration audit records are stored in PostgreSQL and are included in the database backup. Treat these backups as sensitive and restrict access accordingly. Keep `CONFIG_ADMIN_TOKENS` in the deployment secret manager; it is not stored in PostgreSQL and must be restored separately. Ingest Key plaintext is returned only when a key is created, so retain it in the site's secret store when clients need to continue sending events. After a database restore, start the services and wait for their reported applied versions to converge before considering configuration current.

启动 Phase 3 PostgreSQL：

```bash
cp .env.example .env
docker compose --profile storage up -d --wait postgres
export DATABASE_URL=postgres://analytics:analytics@localhost:5432/analytics
pnpm db:migrate
```

执行完整 migration regression。该命令要求 `DATABASE_URL` 和本机可用的
`psql`，会验证首次执行、重复执行、migration history/checksum 以及核心
表、索引和约束，并在隔离临时数据库中验证旧 migration history 升级到当前版本。
执行用户需要拥有 `CREATEDB` 权限：

```bash
pnpm test:migrations
```

运行 PostgreSQL 集成测试：

```bash
DATABASE_URL=postgres://analytics:analytics@localhost:5432/analytics pnpm test:integration
```

PostgreSQL migrations are owned by the repository infrastructure and run by
the standalone `db-migrator`. Collector, Processor, and Analytics API do not
create or upgrade the schema during startup. Deploy the migration job before
deploying services that require the schema.

启动 Collector 和 PostgreSQL 的开发 workflow：

```bash
pnpm docker:backend
```

该命令同时启用 `backend` 和 `storage` profiles。Collector 使用 PostgreSQL；没有 `DATABASE_URL` 时不会静默回退到 InMemory Sink。
`pnpm docker:backend` 会先等待 PostgreSQL 健康、执行 migration，再启动 Collector 和 Playground。

启动 Processor 和 Analytics API workflow：

```bash
pnpm docker:processing
```

该命令启用 `backend`、`storage` 和 `processing` profiles，先执行 migration，再启动 Collector、Processor、Analytics API 和 Playground。Analytics API 地址为 `http://localhost:4002`。

运行完整 Phase 3 E2E workflow：

```bash
pnpm e2e:analytics
```

该命令会启动独立的 PostgreSQL、Collector、Processor one-shot 和 Analytics API 测试环境，逐个执行 canonical fixtures，结束后自动清理自己的容器和 volume，不影响用户已有 PostgreSQL volume。
失败时会把 Compose config、service status 和 Collector、Processor、Analytics API、db-migrate 日志写入 `artifacts/analytics-e2e/`。

### 开发期 MMDB 测试

仓库附带的 [合成 GeoLite2 测试数据库](../tests/fixtures/geo/README.md) 只用于开发测试，不是正式数据集。它只由 `compose.e2e.yaml` 覆盖挂载；普通 Compose/backend 启动使用部署方提供的 `./data/GeoLite2-Country.mmdb`。

只验证本地解析器、已知国家/Unknown、release metadata 和坏文件启动失败时运行：

```bash
pnpm test:geo-mmdb
```

验证本机部署方提供的 DB-IP City Lite 文件（需要放在 `./data/GeoLite2-Country.mmdb`）时运行：

```bash
pnpm test:geo-mmdb-local
```

验证完整 Collector → Processor → Analytics API Geo workflow 时运行：

```bash
E2E_FIXTURES=geo-countries.json pnpm e2e:analytics
```

这两项测试使用仓库里的合成数据库与保留地址，不需要或访问真实访客 IP，也不会下载数据库。测试地址和数据映射见 fixture README。

单独运行 Protocol 校验：

```bash
pnpm protocol:validate
```

## Build

```bash
pnpm build
```

构建当前所有 TypeScript packages，再构建 Next.js Playground 的生产版本。

## Docker Development

需要 Docker 和 Docker Compose v2：

```bash
pnpm docker:dev
```

该命令默认构建并启动 Next Router Playground，访问地址为：

```text
http://localhost:3000
```

默认 Compose 只运行 Playground，不包含 PostgreSQL；页面内的 SDK workflow 使用本地 MockTransport，不发起真实 API request。通过 backend override 可以额外启动 Phase 2 Collector。

Playground 默认使用 MockTransport。要启用本地 Collector workflow，在 `.env` 中设置：

```env
NEXT_PUBLIC_ANALYTICS_TRANSPORT=fetch
NEXT_PUBLIC_ANALYTICS_ENDPOINT=http://localhost:4001/v1/events
NEXT_PUBLIC_ANALYTICS_INGEST_KEY=public-key-example
NEXT_PUBLIC_ANALYTICS_SITE_ID=site_example
```

`NEXT_PUBLIC_ANALYTICS_ENDPOINT` 必须是完整的 `POST /v1/events` URL，不能只填写 Collector base URL。浏览器会自动发送 `Origin`，Collector 会执行 CORS、Origin、Ingest Key、Schema 和限流校验。

启动 Phase 2 Collector：

```bash
docker compose --profile backend up --build collector
```

如果同时启动 Playground，并要求它等待 Collector 健康后再启动：

```bash
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend up --build
```

也可以直接运行：

```bash
pnpm docker:backend
```

切换 Docker playground：

```bash
pnpm docker:dev --router react
pnpm docker:dev --router tanstack
pnpm docker:dev --router react --with-backend
```

默认端口分别为 Next `3000`、React Router `3101` 和 TanStack Router `3102`，可通过 `PLAYGROUND_NEXT_PORT`、`PLAYGROUND_REACT_PORT` 和 `PLAYGROUND_TANSTACK_PORT` 覆盖。`--with-backend` 会启用 `backend`、`storage` 和 `processing` profiles；默认的 `pnpm docker:dev` 只启动选中的 MockTransport playground。

Collector 默认监听 `http://localhost:4001`，健康检查地址为：

```text
http://localhost:4001/health
```

当前 Collector 提供健康检查、配置加载、`POST /v1/events`、Origin/CORS、Public Ingest Key 校验和单进程限流。合法事件暂存于进程内 InMemory Sink；Origin 必须配置在对应 site/environment 的 `allowed_origins` 中。

生成本地测试 key（命令只输出 key，不修改 TOML）：

```bash
cargo run -p collector -- key generate --site site_example --environment production
```

发送一个合法 EventBatch：

```bash
curl -i \\
  -X POST http://localhost:4001/v1/events \\
  -H 'Content-Type: application/json' \\
  -H 'X-Ingest-Key: <configured-key>' \\
  -H 'Origin: https://www.example.com' \\
  --data '{"schema_version":1,"events":[{"schema_version":1,"event_id":"01J00000000000000000000000","type":"page_view","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}]}'
```

成功请求返回 `202` 和已接收事件数量。每个 `site_id + Origin` 默认每分钟允许 600 个请求，超限返回 `429`。当前 Collector 不持久化事件，重启后 InMemory Sink 会清空。

启用完整 Compose workflow：

```bash
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend up --build
```

Transport 不自动重试，也不持久化发送失败的事件。Collector 的 `400`、`401`、`403`、`413`、`429` 和 `5xx` 响应会转换为可识别的 `FetchTransportError`。

## CI

GitHub Actions 会复用本地检查命令，并额外验证 Docker Compose 配置。CI 的
`integration` job 使用 PostgreSQL 18.6 service，先运行 `pnpm test:migrations`，
再运行 `pnpm test:integration`；独立的 `analytics-e2e` 和 `dashboard-e2e`
job 分别运行两个 E2E 命令。失败诊断 artifact 位于 `artifacts/analytics-e2e/`
和 `artifacts/dashboard-e2e/`，CI 会上传它们供下载。migration job 必须先于
Collector、Processor 和 Analytics API 启动。

Collector 配置文件路径可以通过 `COLLECTOR_CONFIG` 指定；示例值见 `.env.example`。

## 当前范围

当前已包含：

- `observer-core` 的通用导航契约
- `observer-next` 的 Next.js App Router Adapter
- `analytics-core` 的基础事件管线
- `analytics-browser` 的 Browser SDK runtime 和 Context provider
- Browser SDK 的本地 Mock Buffer workflow
- `@web-analytics/transport` FetchTransport 和 Collector API workflow
- Next.js Router Playground

当前仍不包含：

- Buffer 持久化、离线队列和 BeaconTransport
- Analytics API 和 Dashboard
