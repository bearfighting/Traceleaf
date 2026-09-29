# ADR-014：Site 运行时配置权威与迁移边界

- Status: Accepted
- Date: 2026-09-28
- Related: [ADR-007](ADR-007-capability-oriented-configuration.md), [ADR-012](ADR-012-phase-8-configuration-contract.md), [M0a baseline](../m0a-baseline-and-decisions.md)

## Context

当前 Site 配置散落在管理 API 的 PostgreSQL 文档、Collector TOML fallback、Dashboard site-list 环境变量、本地显式 seed，以及 Processor 的显式 definitions 文件导入中。运行时应用状态也写入数据库，但它表达服务实例状态，并不是用户配置。必须明确权威和过渡路径，避免环境变量或旧 TOML 在新管理配置缺失后意外重新启用旧站点/key。

## Decisions

1. Site identity、display metadata、capabilities、activation windows、environment policy、Origin、Ingest Key digest/status 和 definition revisions 的唯一运行时权威是 PostgreSQL 中由 Site Management 管理的数据。运行服务可维护自己的 applied/stale heartbeat；状态表不创建或修改 Site 配置。
2. 本决策收窄并明确 [ADR-007 决策 5](ADR-007-capability-oriented-configuration.md)：运行时平台环境变量只配置基础设施和部署级授权，例如数据库/服务地址、监听设置、MMDB 路径、日志级别及 `CONFIG_ADMIN_TOKENS` / Dashboard 服务端 token；它们不创建或覆盖正式 Site、capability、policy 或 Ingest Key。`DASHBOARD_SITES`、Collector TOML 的 Site 项及旧开发 seed 的 Site/key 输入只能由显式、一次性的 migration/import 操作读取，不能由普通服务启动作为 fallback。被观测网站 SDK 的公开接入配置不作为平台运行时数据库的持续初始化来源。
3. Collector TOML 过渡期内可以作为已明确标注的旧配置导入/迁移来源。M3/M4 核对并迁移必要数据后，常规运行必须移除其 Site policy fallback。数据库 policy 行明确缺失、禁用或 Site 归档时 fail closed；DB 暂时不可用时可保留进程已有 last-known-good 并报告 stale，这两种状态不得混为一谈。
4. `ANALYTICS_DEFINITIONS_FILE` 只允许由显式 `--import-definitions-if-empty` 路径用于历史/初始数据迁移。普通 Processor 启动与处理循环不隐式读取该文件，也不覆盖数据库 definition revisions。目标状态下正常 definition 创建/修改由 Site Management 管理，Processor/Analytics 按 revision 只读。
5. `--seed-init`（允许 CLI 暂存 alias `--seed`）是目标中的本地开发显式操作，只初始化固定示例 Site 配置及 key digest，不自动制造分析事件、不覆盖用户修改，不从普通平台 `.env` 读取 Site/key 运行时值，也不进入基础 Compose、CI 或 E2E 默认路径。当前 `compose.dev.yaml` 会随 `pnpm dev:up` 自动执行 seed；M6 负责切换到默认空站点、显式启用固定本地 seed。未来合成分析数据使用独立 `seed-analysis`。
6. 管理员部署凭据属于基础设施配置，不是 Site Ingest Key。当前一至两个重叠 Bearer token 的模式仅支持受信任的管理员入口；Dashboard 只在服务端使用。多用户身份、RBAC 和公开管理服务不由本 ADR 定义。
7. Schema 是跨语言 contract 与开发/CI 验证依据，当前生产 Schema runtime 使用方式及静态替换由 M0b/M2/M9 处理。本 ADR 不选择生成器、未知字段策略，也不改变现有输入验证。

## Migration constraints

- 在从 TOML 移除 fallback 前，合并并核对所有旧 Site ID 来源：DB capability/policy/definition 及 analytics history、`DASHBOARD_SITES`/`DASHBOARD_DEFAULT_SITE`、Collector TOML 的 Site/environment 项。为每个来源记录候选数量、重叠、缺失元数据和差异；环境变量和 TOML 只作为一次性迁移输入，不作为迁移后的运行时 fallback。核对 enabled 状态、Origin、限流和 key digest；迁移不得输出明文 key 或复制日志中的 secret。
- 回填不从 Origin 假定 website URL，不更换历史 `site_id`，不删除 raw events、derived facts、definition revisions 或 configuration audit。旧开发 seed 的 `NEXT_PUBLIC_ANALYTICS_SITE_ID` 等输入仅用于对应本地环境的显式迁移核对，不导入生产数据，也不作为新 seed 的配置来源。
- 删除 DB policy 行后，已移除的 TOML 配置不能恢复接收能力。可保留 last-known-good 仅限明确的暂时存储故障状态，并上报 stale。
- Processor 文件导入执行前后需核对 revision 数量、版本和审计记录；该命令不能被普通服务启动配置自动触发。
- runtime applied-state migration/cleanup 与用户配置 migration 分开，不能把过期 heartbeat 当作 Registry 数据来源。

## Consequences

- M3/M4 先盘点并迁移历史配置，再关闭 fallback；不能先删旧来源再尝试恢复。
- M6 普通开发启动留空站点体验，用户显式请求 seed 后才创建示例站点。
- M8 清理 `DASHBOARD_SITES`、Collector site TOML 与 Playground 对平台初始化的 site/key env wiring。
- 现有部署级 admin token 是本阶段唯一授权模式；向不受信任网络开放前需要后续身份/授权设计。
