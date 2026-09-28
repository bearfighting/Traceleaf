# MVP Release Readiness Design

> Status: In progress — latest CI was reported green on 2026-09-27. Remaining MVP work is functional regression and the clean-environment workflow check; Docker/CI cache performance evaluation is deferred until after product operation.
> Scope: MVP 功能、migration、integration 与 E2E 回归；产品实际运行后的运维 hardening、retention、生产部署恢复及 SDK 独立发布另行跟进

## 1. 阶段定位

MVP Release Readiness 不新增产品功能，负责确认 Phase 7 和 Phase 8 的功能结果通过 CI、migration、integration、E2E 和 Chromium smoke test。它不要求生产级运维演练或 SDK 正式发布。产品实际运行后的专项事项见第 7 节。

功能开发期间仍需同步编写单元测试、fixture 和最小 E2E；本阶段负责 MVP 范围内的完整回归。

## 2. 执行顺序

```text
Protocol validation
  → migration regression
  → integration test
  → Analytics E2E
  → Dashboard / Configuration E2E
  → Chromium smoke test
  → clean-environment MVP workflow check
  → product operation
  → post-launch operational and publication follow-up
```

本节记录已有本地测量与缓存实现，作为产品实际运行后的性能优化参考，不属于 MVP Release Readiness 退出条件。当前本地 E2E 使用独立持久卷复用 Cargo target、Cargo registry、pnpm 安装结果和 Dashboard .next；PostgreSQL 测试数据、migration 和 fixture 仍在每次运行中重建。产品运行后可再根据实际成本决定是否优化依赖下载、服务编译与 CI 跨运行缓存。

- Cargo 和 pnpm 依赖层由 lockfile 与 manifest 驱动；依赖未变时不得重复大规模下载。
- Cargo 编译产物、Dashboard `.next` 和容器内 `node_modules` 使用按 workspace/依赖版本隔离的可复用缓存；Dashboard `.next` 还按 E2E 套件隔离，避免并行写缓存。E2E 清理不得删除这些构建缓存。
- 服务镜像使用 Docker/BuildKit layer cache；源码变化后由 Cargo/Next.js 在持久缓存上增量重编译。
- PostgreSQL 测试 volume、migration 和测试 fixture 每次仍从干净状态创建，以保持验收隔离。
- 本地基线（2026-09-27，Docker 29.5.2，workspace cache prefix `web-analytics-e2e-564462637f69`）：冷启动只清理该 workspace 的 E2E 缓存卷，保留 Docker/BuildKit 镜像层；热启动紧接冷启动，运行间不清缓存。

  | E2E           |          冷启动 |          热启动 | 观察结果     |
  | ------------- | --------------: | --------------: | ------------ |
  | Analytics     | 156.60 秒，通过 |  65.37 秒，通过 | 热跑快 58.3% |
  | Dashboard     | 273.52 秒，通过 |  89.61 秒，通过 | 热跑快 67.2% |
  | Configuration | 233.04 秒，通过 | 117.09 秒，通过 | 热跑快 49.8% |

- Dashboard 首轮热跑两次在 `Replacement key was not created` 断言失败；service log 显示第二次重试中的两个 key 创建请求均返回 HTTP 201。测试原先立即读取 key 列表数量，现改为等待列表达到两项。修复后的 Dashboard 冷、热运行均通过。
- 每次 E2E 均移除了自身 PostgreSQL 测试数据卷，workspace 持久缓存卷保留。Dashboard API-error 实例的按 PID 命名 `.next` 卷由该场景的清理逻辑在容器退出后精确删除；清理会保留原始测试错误并报告额外清理错误。
- 隔离复验（2026-09-27）：Analytics、Dashboard、Configuration E2E 顺序通过；各自的 PostgreSQL 测试卷在退出后删除，workspace 缓存卷持续保留。Dashboard API-error 临时 `.next` 卷在退出后删除。开发 PostgreSQL 在复验前已是 `Exited`，复验后状态未变；E2E 未启动或修改它。
- 三套 Compose 构建日志中，`cargo fetch --locked`、`pnpm install --frozen-lockfile` 及 migrator release build 层均显示 `CACHED`。服务以 detached 模式启动，当前日志没有保留其运行时 stdout，因此尚不能直接确认 Cargo target 命中后是否完全避免完整重编译。原始日志和耗时保存在本机忽略目录 `artifacts/docker-cache-benchmark/`；该目录也保留 Dashboard 修复前的两次失败记录及修复后的冷、热日志。
- 三套修复后的 E2E 冷、热运行均通过。服务运行时编译/下载日志可见性及 Cargo target 热跑行为留待后续性能优化时再评估，不阻塞 MVP。
- CI E2E 使用托管临时 runner，跨 job/run 缓存不会自动保留。Analytics、Dashboard 和 Configuration job 现由统一测量脚本记录 E2E 命令耗时、Compose/BuildKit plain 输出，以及命令前后的 runner 默认网络接口接收字节差；每个 job 始终上传日志和 JSON 摘要到独立 artifact。接收字节差是整个 runner 的近似入站流量，不代表 Docker 专属下载量；需结合 plain 日志判断依赖下载和镜像构建缓存情况。
- CI 的 Analytics、Dashboard 和 Configuration job 会上传运行测量摘要与 Compose/BuildKit 日志。最新 CI 于 2026-09-27 通过（由本次工作提供的信息确认）；三个 job 的性能 artifacts 尚未复核。基线分析、Docker/BuildKit 跨运行缓存对照和性能门槛判断统一延期至产品实际运行后；不影响当前 CI 与 E2E 必须通过的 MVP 门槛。

本地与 CI 缓存性能优化不作为 MVP 前置任务。MVP 阶段继续执行完整的 CI、migration、integration 和 E2E 功能回归；性能基线及缓存策略在产品实际运行后评估。

## 4. CI 基线

`validate` job 必须执行：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm test
pnpm build
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend \
  --profile storage \
  --profile processing \
  --profile dashboard \
  config --quiet
```

Rust 步骤必须有明确名称：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --workspace
```

本地和 CI 使用同一组入口命令：

```bash
pnpm check
pnpm format:check
pnpm test
pnpm build
pnpm test:migrations
pnpm test:integration
pnpm e2e:analytics
pnpm exec playwright install --with-deps chromium
pnpm e2e:dashboard
```

## 5. PostgreSQL 和 migration

使用 PostgreSQL 18.6 验证：

- 空数据库首次 migration；
- migration 重复执行；
- `_sqlx_migrations` history、checksum 和描述；
- 核心表、索引和约束；
- 已有 history 升级到当前版本；
- integration test；
- 不修改已执行 SQL migration。

统一本地和 CI 命令：

```bash
pnpm test:migrations
pnpm test:integration
```

## 6. E2E 和 MVP 浏览器覆盖

Analytics E2E、Dashboard E2E 和 Configuration E2E 使用独立 Compose project、端口和测试数据 volume，不删除开发数据库 volume。Cargo target、Cargo registry、Node modules 和 Dashboard 构建缓存使用独立、持久的 cache volume；清理测试项目时保留这些缓存。Dashboard `.next` 缓存按 E2E 套件隔离。

失败时保留：

- Compose config；
- service status；
- migration、Collector、Processor、Analytics API 日志；
- Dashboard screenshot、trace 和 service diagnostics；
- 测试输出和 Processor 结果。

统一写入：

```text
artifacts/integration/
artifacts/analytics-e2e/
artifacts/dashboard-e2e/
```

MVP 验收保留 CI 中现有的 Chromium Dashboard smoke test。覆盖 SDK 初始化、consent、storage、navigation、transport 和 capability 事件的完整浏览器矩阵延期至 MVP 之后，不作为 MVP Release Candidate 退出条件。MVP 的 CI 和本地 RC 验证统一使用以下 Chromium 安装命令：

```bash
pnpm exec playwright install --with-deps chromium
```

`pnpm playwright:install` 只安装 Chromium，适用于 MVP Dashboard smoke test。Firefox/WebKit 覆盖属于 post-MVP 浏览器矩阵。

## 7. 产品实际运行后的运维与发布工作

以下事项明确移出 MVP Release Readiness。待产品实际运行并积累部署经验后，再分别制定执行计划；它们不阻塞 MVP 完成。

### 7.1 Docker 与 CI 性能优化

本地 E2E 冷/热缓存优化的进一步评估、E2E 服务运行时编译日志检查、三个 E2E CI measurement artifacts 分析，以及 Docker/BuildKit 跨运行缓存对照实验，均推迟到产品实际运行后。CI job 保留现有测量和诊断产物上传，但无需在 MVP 阶段分析性能数据或据此调整 workflow。

### 7.2 Collector 专项运行时 hardening

后续评估 body/header/Origin/Ingest Key/batch 限制、request 与 database acquire/shutdown timeout、数据库故障恢复、SIGTERM/容器停止、readiness/migration 状态、日志脱敏、重复事件和限流等生产运行边界。功能级请求校验、错误语义与现有 CI 覆盖仍属于 MVP 功能质量门槛。

### 7.3 Analytics 数据 retention

产品实际运行后再制定 Raw Events、Context、facts 和 aggregates 的保留关系，评估 dry-run、影响范围、安全删除顺序、中断恢复和一致性校验。Phase 8 已定的一年期 configuration audit expiry 与现有每日 purger 是既有行为；本次延期不改变它们，也不新增 analytics data 自动删除策略。

### 7.4 生产部署、country Geo 与 SDK 发布

产品实际运行后再安排：

- country Geo 在 staging/实际部署中的覆盖率、unknown 比例、Collector 启动、MMDB 离线更新和回滚验证；
- 生产环境 migration、backup/restore、服务镜像 rollback 演练；
- SDK 内部 workspace runtime dependencies 的独立发布或打包方案；
- SDK package 的独立 consumer 安装 smoke test、版本/tag 与正式发布流程。

现有 Getting Started 中的部署、Geo、数据库迁移和恢复说明作为后续操作参考保留；它们不构成 MVP 发布门槛。SDK packaging 和独立安装验证全部属于 post-launch 工作。

### 7.5 已修复的 package 内容问题

2026-09-27 的 SDK `pack --dry-run` 首次发现 tarball 漏掉运行所需的编译模块和声明文件，并包含源码测试/开发配置。`packages/analytics-browser/package.json` 已增加 `files` allowlist；复验 tarball 包含完整 `dist`、README 和 LICENSE，且不再包含 `src` 测试。`private: true` 保留。该局部缺陷已修复；SDK 内部 runtime dependencies 的发布/打包设计、独立安装验证和正式发布流程均留待产品实际运行后处理，不作为 MVP gate。

## 8. MVP Release Readiness 退出条件

- Phase 7 和 Phase 8 的 MVP capability 与配置验收完成；
- Geo region/city 已明确延期至 MVP 之后；country Geo staging 评估列为 post-launch；
- CI、migration、integration、Analytics E2E、Dashboard E2E 和 Configuration E2E 全部通过；
- CI 中现有的 Chromium Dashboard smoke test 通过；Firefox/WebKit 浏览器矩阵延期至 MVP 之后；
- SDK bundle/build 检查通过；
- 干净环境中的 MVP 功能启动和核心 workflow 检查完成，并记录已知限制。

Collector 专项 hardening、Analytics retention policy、country Geo staging、生产 backup/restore/rollback 演练，以及 SDK 独立安装和正式发布均不属于以上退出条件；待产品实际运行后安排。
