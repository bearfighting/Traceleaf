# 站点接入与 Settings 重构设计

- Status: Proposed
- Scope: Site onboarding, runtime configuration ownership, Settings information architecture, optional development seed
- Overall sequence and gates: [Platform Improvement Roadmap](platform-improvement-roadmap.md)
- Related: [Dashboard UI Improvements](dashboard-ui-improvements.md), [Capability-oriented configuration (ADR-007)](decisions/ADR-007-capability-oriented-configuration.md)
- Runtime contract direction: [Protocol Schema and Static Runtime Models](protocol-static-runtime-design.md)
- Backend owner: [Analytics and Site Management Module Boundaries](analytics-site-management-module-boundaries.md)

## 背景与问题

当前 Dashboard 的站点清单和默认站点来自 `DASHBOARD_SITES`、`DASHBOARD_DEFAULT_SITE`；默认 Settings 环境来自 `DASHBOARD_DEFAULT_ENVIRONMENT`。开发 Compose seed 又从 `NEXT_PUBLIC_ANALYTICS_SITE_ID`、`NEXT_PUBLIC_ANALYTICS_INGEST_KEY` 和 Origin 环境变量初始化站点策略。Collector 只从数据库加载 environment policy；旧 TOML 示例不再作为运行时 fallback。Processor 还提供显式 `--import-definitions-if-empty` 命令，可从 `ANALYTICS_DEFINITIONS_FILE` 初始化 definition revisions；普通处理循环不会自动执行该导入。

Settings 页面目前把 capability 开关、环境接收策略、Allowed Origins、Ingest Keys 和 conversion/funnel definitions 放在一张长页面里。它能管理已知站点的部分配置，但没有创建站点的完整 workflow。UI 站点列表由环境变量维护，因此用户无法通过产品界面新增一个可观测网站。

这些问题同时涉及产品流程、持久化模型、API、Collector 配置优先级和 UI，不应只通过调整表单布局解决。

## 目标

1. 用户可以从空数据库状态开始，通过 Dashboard 创建并接入第一个观测站点。
2. 站点元数据和运行时采集策略以数据库为唯一权威来源，不再通过平台 `.env` 初始化。
3. 新站点创建流程能一次配置站点身份、capabilities、环境 Origin 和初始 Ingest Key。
4. Settings 按站点和任务组织，可扩展且不再是一张混合配置长页面。
5. 开发 seed 保留为显式快捷路径，不改变普通启动时的空站点体验。
6. 保留当前 deployment-admin 授权边界、配置审计、事件隐私约束和既有分析数据。

## 非目标

- 本设计本身不新增 Analytics 指标、Event Protocol 字段或 Processor 语义。
- 网站 URL 可达检查不证明用户拥有该域名，也不代表 SDK 已正确发送事件。
- 不在初始实施中引入多租户 RBAC、团队成员管理或任意配置文件导入。
- 不默认生成伪造分析事件；分析演示数据由独立 seed 选项控制。

## 配置权威边界

### 数据库中的运行时 Site 配置

以下数据由站点创建向导和 Settings API 管理并持久化：

- Site ID、显示名称、网站 URL、创建/更新时间和生命周期状态。
- Site capabilities 及其配置版本和 activation windows。
- Environment 名称、启用状态、Allowed Origins、限流策略。
- Ingest Key 的 ID、SHA-256 摘要、创建/撤销状态。
- Conversion/funnel definitions 和版本。

Collector 和 Analytics API 从持久化配置读取这些数据。Dashboard 的站点选择器和默认站点由数据库中的 Site 列表驱动，不再由 `DASHBOARD_SITES` 或 `DASHBOARD_DEFAULT_SITE` 控制。环境由 UI 显式选择；`DASHBOARD_DEFAULT_ENVIRONMENT` 不再决定实际站点策略。

### 基础设施配置

环境变量只提供部署和服务运行所需的基础设施设置，例如数据库 URL、服务监听地址、Analytics API 内部地址、MMDB 路径、日志等级和部署级管理凭据。

`CONFIG_ADMIN_TOKENS` / `DASHBOARD_CONFIG_ADMIN_TOKEN` 是 deployment-admin 授权凭据，不是 Site Ingest Key。MVP 可继续使用现有授权模式，但必须保持在服务端，不能暴露给浏览器。

首次安装平台时，部署者生成一个符合后端要求的 32 字节 Base64URL token：将其放入 `CONFIG_ADMIN_TOKENS` JSON 数组，并将同一个 token 设置为 Dashboard 服务端的 `DASHBOARD_CONFIG_ADMIN_TOKEN`。这属于一次性基础设施设置；之后新增 Site 不再编辑平台 `.env`。两个值缺失或不匹配时，Dashboard 显示“管理功能未配置/无权限”及设置指引，不能把管理 API 的 401/503 当作空 Site Registry。当前全局管理员 token 只适用于受信任的管理网络或受保护的 Dashboard 部署。

被观测网站的 SDK 仍需要收到其 Site ID、Environment 和 Ingest Key。Ingest Key 在平台创建时由用户复制到目标网站的 SDK 配置；这属于目标网站的接入配置，不能反过来作为 Analytics Platform 初始化数据库策略的来源。

### Collector TOML 与 Processor definitions 文件过渡

旧版 `COLLECTOR_CONFIG` TOML 曾包含 Site/environment policy。当前 Collector 不再加载该文件或提供 TOML Site fallback；每个目标仍须在启用此版本前完成独立核对，避免遗漏仅存在于旧 TOML 的有效策略。

若 TOML 仍需保留，职责应限于明确的本地/紧急 bootstrap，并由单独开关启用；不能与数据库策略静默合并成为第二个运行时权威源。`ANALYTICS_DEFINITIONS_FILE` 已导入的 definitions 也须核对到数据库；显式 Processor 导入命令仅保留为历史数据迁移工具，普通启动与新增站点流程不依赖该文件。

## 数据模型与 API 方向

本节的数据写入和创建事务由 Site Management module 拥有。Site 领域语义由 M0a/ADR-013 冻结，静态配置模型由 M0b/M2 决定；新 Registry migration 在 M3 实施，新 Site API 的 wire contract 与错误语义在 M5 冻结。Dashboard 只通过管理 API 使用这些能力。

### Site Registry

新增数据库级 Site Registry，至少保存：

- 稳定唯一的 `site_id`；新 Site ID 由服务端生成，不从名称或 URL 推导；迁入旧数据时保留原 ID。
- 用户输入的 `display_name`；名称无需全局唯一，可以修改。
- `website_url` 或规范化后的 primary URL/origin；新建必填，迁入的旧站点若无可靠 URL 可暂时为空并提示管理员补齐。
- 生命周期状态 active / archived；管理 UI 的 ready / needs_attention 是根据缺失元数据或配置推导的 setup 状态，不替代生命周期状态。
- 创建和更新时间。

现有 `site_capability_configurations` 可继续作为 capabilities 存储；`site_environment_policies` 继续保存各环境策略。新 Site Registry 成为这些配置的父级关系，并由外键或事务逻辑保证引用有效。Site 的 display name/URL 不应塞入现有 capability 或 policy JSON 文档。

现有站点在 migration/rollout 中需要迁入 Registry。回填应覆盖 capability、policy、definition 记录以及历史分析数据中的 Site ID。对仅有 Site ID 而缺少名称的记录，可暂用 Site ID 作为显示名称；没有可靠网站 URL 时应标记为待确认，已知 Allowed Origin 仅作为管理员编辑时的建议，不能静默推断为权威 URL。缺少 URL 的旧 Site 若已有有效 policy，采集仍继续；缺少 policy 的 Site 可查询历史数据，但不得接收新事件。管理界面显示 needs_attention 和具体缺失项。现有 raw events 和派生数据保持不变。

### Admin API

以下路由方向现由 M5.1 HTTP contract 冻结；字段、错误 envelope、ETag、幂等摘要和持久化细节见 [configuration OpenAPI](../protocol/contracts/configuration/current/openapi.json)、[Site creation schema](../protocol/contracts/configuration/current/site-create-request.schema.json) 与 [persistence contract](../protocol/contracts/configuration/current/site-management-persistence.md)。实现仍按 M5.2/M5.3 顺序交付。

提供受 deployment-admin 保护的站点集合、创建、元数据和生命周期接口：

- `GET /v1/admin/sites`：列出 Site Registry 元数据和基本可用状态。
- `POST /v1/admin/sites`：创建站点及首个环境。
- `GET /v1/admin/sites/{site_id}` / `PATCH`：读取和更新名称、URL。
- `POST /v1/admin/sites/{site_id}/archive` 和 `/restore`：使用 Site ETag 修改生命周期；恢复不自动启用 policy。

创建接口应在一个数据库事务内创建 Site Registry、capability configuration、activation windows、首个 environment policy 和 Ingest Key 摘要，并写入审计记录。任何一步失败都应回滚，避免出现下拉列表里有站点但 Collector 无法接受事件的半成品状态。

`POST /v1/admin/sites` 要求客户端生成的 `Idempotency-Key`。创建事务保存唯一创建请求 ID、规范化请求摘要和 Site ID。首次成功返回 `201`、站点元数据及一次性明文 Ingest Key；相同 key 和相同请求重试返回 `200` 与站点元数据，不重放明文；相同 key 对应不同请求返回 `409`。请求 ID 与 Site 保持关联，在 Site 生命周期内不设过期时间；归档后仍保留，Site ID 不得重用。数据库只保存 key 摘要和 key ID，不为重试保存可恢复的明文。若首次响应丢失，管理员通过创建 replacement key 恢复。

现有 capabilities、environment policy、key rotation/revocation 和 definitions APIs 继续提供各自的独立管理能力；站点创建 API 是向导的一次性协调入口，不应复制这些领域的验证规则。

### Audit 与生命周期

`configuration_audit` 目前覆盖 capabilities、environment policy 和 ingest keys。站点创建、名称/URL 变更、归档/恢复需要可追踪；应扩展审计 resource/operation contract 或建立独立的 Site audit 类型。

首期提供归档，不提供物理删除。归档后 Collector 拒收新事件；历史报告仍可查询，key 摘要和审计保留。恢复归档 Site 不自动重新开启 environment ingestion，管理员须显式确认或启用 policy。物理删除与隐私删除另行定义 raw events、派生事实、definitions 和审计历史的保留政策。

## 首次添加站点向导

当 Site Registry 为空时，Dashboard 应显示产品引导页和“添加观测站点”入口，不显示无效站点下拉框或空白 Settings 表单。

向导建议分为以下步骤：

### 1. 站点信息

- 必填显示名称。
- 必填网站 URL，限制到 HTTP(S)，规范化 scheme/host/port。
- 从 URL 自动填入 primary Origin，并允许增加/修改多个 Allowed Origins，例如 `www`、应用子域名或本地开发地址。
- 明确区分 Site URL 与 Allowed Origins：前者用于展示/验证，后者是 Collector 的安全接收白名单。

### 2. 可达性检查（可选后续任务）

- 首版只校验 URL 语法和最终 Allowed Origins；可达性检查作为独立后续任务，不阻止管理员在临时故障或私有测试环境中创建站点。
- 结果明确表示只检查 HTTP 可达性；不能声称已证明域名所有权或 SDK 接入成功。
- 若由 Dashboard 服务端请求用户输入 URL，必须按 SSRF 防护设计：仅允许 HTTP(S)、限制目标端口和地址范围、拒绝 loopback/private/link-local/metadata 地址、关闭或逐跳重新验证重定向、设置超时和响应上限，并处理 DNS rebinding。参见 [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。
- 可替代方案是先做语法校验和用户浏览器发起的安装/连接检查；若要证明域名控制权，应设计独立的 DNS 或 well-known 文件 challenge。

### 3. 观测能力

以用户可读名称和简短说明展示能力，并从 capability manifest 读取依赖关系，避免 UI 和后端依赖表漂移：

- Page Views：必选且默认开启的基线能力。其余能力初始关闭，由管理员选择；UI 自动提示依赖，服务端最终校验。
- Browser Context / Dimensions：选择维度报表时自动满足 Browser Context 依赖。
- Anonymous Visitors / Sessions：选择 Sessions 时自动满足 Visitors 依赖。
- Custom Events：独立选择。
- Web Vitals：独立选择。
- Geo country：说明需要受支持的 MMDB/Geo 配置。
- Conversions / Funnels：默认收在高级配置；选择时自动要求 Custom Events / Conversions 等依赖。

能力选择必须经过服务端 contract 校验；前端提示不能取代 API 验证。页面也应说明启用新能力不一定会补算已有历史数据，具体回填行为由 capability contract 决定。

### 4. Environment 与 Origins

- 首次创建 Site 时创建一个 Environment policy；向导默认建议 `production`，管理员可修改；显式本地演示 seed 使用 `development`。
- Origins 默认值从 Site URL 初始化，支持多个 Origin，并在保存前显示最终白名单。
- 限流采用系统默认值，初始向导把高级策略折叠；Settings 后续可调整。
- 环境之间的 Origin 唯一性和 key 隔离仍由服务端与数据库约束保证。

### 5. 高级 Definitions

- 初次接入可跳过 Conversions / Funnels definitions。
- 用户选择配置时展示现有 definition editor，支持分步或折叠编辑。
- 对依赖 definitions 才能查询的报表，明确提示配置要求，不伪装成“没有事件数据”。

### 6. 创建完成与 SDK 安装

- 提交前显示 Site、Environment、Origins 和 capability 摘要。
- 服务端原子创建相关记录和 Ingest Key。
- 创建成功后只展示一次明文 key，提供复制按钮、SDK 初始化示例和“我已安装”步骤。
- 未收到事件显示“等待首个事件”；Collector 接受事件后显示已连接及最近接收时间。
- 离开一次性 secret 页面后不再展示明文；用户可创建 replacement key，验证新 key 后撤销旧 key。

## Settings 信息架构

沿用 [Dashboard UI Improvements](dashboard-ui-improvements.md) 的 Global Header：Analytics / Settings 为一级导航。

Settings 区域使用面包屑表达层级，并提供站点级二级 Sidebar：

```text
Settings / example.com
├── Overview
├── Capabilities
├── Environments & Origins
├── Ingest Keys
└── Definitions
```

Site Registry 是所有站点选择器的唯一来源。管理凭据未配置或管理 API 不可用时显示明确错误，不进入空站点引导。站点为空时展示 onboarding；有站点时提供新增站点入口；needs_attention 的旧站点可进入修复页并继续查看历史报告。Overview 显示网站 URL、环境、接入状态和最近事件；各配置页只呈现一个关注领域，避免 capability、keys 和 definitions 混在一起。

Analytics Sidebar 与 Settings Sidebar 是不同上下文：Analytics Sidebar 按报表能力导航；Settings Sidebar 按配置任务导航。两者共享 Header、主题和基础控件，不共享错误的导航语义。

## Ingest Key 生命周期

- Site onboarding 为首个 Environment 自动生成一个 key。
- key 明文只在生成/轮换响应展示一次；持久化只保存 SHA-256 digest、key ID 和生命周期元数据。
- UI 不显示 key 来自哪个环境变量，因为平台环境变量不再注入 Site key。
- 轮换流程先创建 replacement，提供切换窗口和验证状态，管理员确认后撤销旧 key。
- audit 记录创建、撤销与相关 key ID；禁止记录明文 key。
- SDK 接入向导说明 key 对浏览器客户端属于可公开的 Ingest credential，安全控制依赖 Origin 白名单、限流和服务端校验，不应把它描述成可保护的 server secret。

## Development Seed 约定

目标状态下普通 `pnpm dev:up` 不自动运行 seed，以便验证首次 onboarding。显式 seed 入口应在 Dashboard 空站点流程验收之前交付；已存在的数据卷不因启动方式切换而被清空。Seed 作为显式本地快捷项：

- 目标 CLI 将提供显式 `--seed-init`（`--seed` 可作为简写），只创建固定本地演示 Site、capabilities、development policy 和本地 key 摘要；不创建分析事件。当前 `pnpm dev:up` 自动运行开发 seed，切换为默认空站点由 M6 完成。
- 将来可单独提供 `--seed-init` 和 `--seed-analysis`。前者初始化配置；后者只导入固定的合成分析数据，并要求 demo Site 已存在。组合运行可以使用 `--seed --seed-analysis`。
- Seed 只允许在开发 Compose workflow 使用，必须有明确 flag；CI/E2E 使用各自隔离 fixture，不受影响。
- Seed 数据应固定、明确标注为 demo/local only；不得从常规平台 `.env` 推导 Site runtime config。
- Seed 幂等、不覆盖手工修改的配置；需要重置数据时使用单独且明确的 destructive 命令，不与 `dev:down` 绑定。

## 迁移与渐进实施

总体实施顺序和跨任务门槛以 [Platform Improvement Roadmap](platform-improvement-roadmap.md) 的 M0a/M0b、M1–M9 为准；以下步骤描述站点接入领域自己的交付细节。Site Management `mod` 和相关静态配置 contract 应先于新增 Site API 建立；Collector 配置权威切换应先于面向用户开放创建向导。

1. **契约与模型**：按 M0a 与 ADR-013/014 执行已冻结的 Site/生命周期/配置权威语义；Site API wire contract、错误响应及幂等摘要格式在 M5 单独冻结。
2. **数据迁移兼容**：增加 Site Registry migration；为现有 capability/policy/definition 及历史分析数据中的 Site ID 建立元数据。准备一次性 importer/运维步骤，合并当前环境变量清单、Collector TOML fallback、DB 配置及历史 analytics 中的 Site ID；开发环境另核对旧 seed 输入。它们只作为迁移清点来源，不能成为迁移后运行时配置。核对 Processor 从 definitions 文件显式导入的 revisions，并人工补齐名称/URL。
3. **Collector 与 definitions 权威切换**：确认数据库管理 Site 的加载、归档和缺失策略语义；移除重复 TOML runtime policy，验证旧 key 不会复活；限定 Processor 文件导入为历史迁移工具。
4. **Admin API**：实现站点列表、创建和元数据更新；确保完整创建事务、幂等重试、审计和权限保护。
5. **显式开发 seed**：将自动 seed 改为 `--seed`/`--seed-init`，先验证空环境与 seeded 环境两个入口。
6. **Dashboard onboarding**：区分凭据未配置、空站点和旧站点待修复；完成创建向导、能力依赖、一次性 key 展示和首事件状态。网站可达 probe 延后。
7. **Settings 重组**：以 Site Registry 驱动站点选择器，增加站点级二级导航、breadcrumb 和主题组件；保留 Analytics UI 改进方案中的 capability Sidebar。
8. **移除旧配置来源**：迁移完成并核对后删除 `DASHBOARD_SITES`、`DASHBOARD_DEFAULT_SITE`、站点策略型 Collector TOML 项和用于平台初始化的 NEXT_PUBLIC site/key env wiring。Playground 自身若需发送事件，应作为被观测客户端接入配置，通过 SDK 步骤配置，不能成为 Platform DB source of truth。

每阶段支持回滚；数据迁移不得删除 raw events、derived facts 或 key audit history。

## 已冻结语义与延期事项

- **环境选择**：首个 environment 创建表单默认 `production` 且允许修改；显式开发 seed 使用 `development`。这是显式创建值，不是运行时隐式默认；现有 E2E/部署 environment 名继续按请求值工作。
- **URL 检查（延期）**：首版仅做 URL 语法与 Origin 规则校验；服务端可达性 probe 和域名控制权 challenge 是独立后续任务。
- **环境模型**：已冻结：一个 Site ID 跨多个 environment 共享；首次向导创建一个显式 environment，其他 environment 之后由 Settings 添加。现有 policy 主键 `(site_id, environment)` 支持该关系。
- **Capabilities 默认值**：已冻结：新 Site 仅 Page Views 默认开启，其余能力初始关闭并由用户选择；服务端按 capability manifest 校验依赖。迁移旧 Site 保留其原有有效状态。
- **旧站点迁移**：名称和网站 URL 无法总是从旧 ID 推断；迁入记录应显示 needs_attention 与具体缺失项，同时保留原有有效采集策略和历史报表。
- **部署授权**：当前全局 deployment-admin token 可支持受信任单管理员 MVP；开放给多个用户前需要用户身份、角色和审计 actor 升级。
- **归档/删除**：首版归档停止新事件、保留历史报告和 key 摘要；恢复需显式确认 policy。物理删除及隐私删除另立任务。
- **并发与重试**：已冻结领域语义：服务端生成 Site ID；同一创建请求 ID/相同规范化摘要幂等返回元数据、不重放明文 key；同一 ID/不同摘要冲突；关联在 Site 生命周期内不设过期时间。M5 冻结具体 wire contract 与字段规范。
- **状态新鲜度**：Collector policy refresh 当前为周期性更新；向导应显示“配置已保存/Collector 尚未应用/已生效”，而不是保存成功就立即宣称采集已就绪。

## 验收标准

- 完成管理员基础设施凭据设置后，空数据库启动不自动创建 Site；Dashboard 显示首次 onboarding。凭据缺失或错误有独立设置状态。
- 一次性管理员基础设施凭据配置完成后，每个新站点都可只通过 Dashboard 创建，不需要为该站点修改平台 `.env`、Compose 或 Collector TOML。
- 创建成功后 Registry、capabilities、activation windows、environment policy、key digest 和审计记录完整且原子可见。
- Ingest Key 明文只返回一次；DB、logs、audit 和浏览器错误中均不泄露明文。
- Collector 从 DB 应用新 policy；移除/归档 Site 不会由旧 TOML fallback 复活。
- origin、capability dependencies、environment 间唯一性和 definitions 均由服务端校验。
- 首版 URL 校验只检查 HTTP(S) 语法与 Origin 规则；若未来加入服务端可达性 probe，另行验收其 SSRF 防护、地址限制和重定向处理。
- `pnpm dev:up` 在目标状态下不自动 seed；显式 `--seed` 可重复创建本地 demo Site，且不清空现有卷；seed-analysis（未来）只写入合成分析事实。
- Dashboard Analytics 和 Settings 导航清楚；loading、empty、disabled、waiting-for-first-event、stale runtime、error 状态可区分。
- 现有 E2E/CI fixture 隔离，旧站点分析事实与 key audit history 保留。
