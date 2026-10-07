# Dashboard 设置流程重构计划

本计划对应[代码重构 Checklist 工作包 3](./code-refactoring-checklist.md#工作包-3dashboard-定义配置和密钥管理)。工作包 3 包含多个状态和风险不同的设置流程；先按可独立验收的领域切片实施，不先建立横向通用框架。

## 工作包 3.1 静态复核与切片排序（2026-10-06）

本节依据当前源码、测试、route 和 loader 静态核对；未修改产品代码或测试，也未运行产品测试。工作包 2 刚运行的 Dashboard/E2E 结果不作为工作包 3 的实现验证。

- Settings 共享页面入口主要在 `components/settings-task-page.tsx`：读取 search params、选择 Site/Environment、调用 server-only loader，再装配 `ConfigurationEditor` 或 `IngestKeysManager`。Capabilities、Environments 和 Ingest Keys 三个 page 都委托给该入口。Definitions 有单独的 server page，加载目录、定义集和 revision history，再呈现 `DefinitionEditor`。
- `DefinitionEditor`（528 行）混合 conversion/funnel draft 更新、属性条件编辑、dirty/baseline 对比、save/reload fetch、ETag/revision 冲突处理和视图。现有 `definition-editor.test.tsx` 已覆盖未配置/错误状态、已存 ID 锁定、空表单、pending、validation error、409 冲突、未保存修改确认和 reload；Definitions page 测试检查无 environment 依赖及历史版本入口。revision history 在 server page 侧，不应因拆分 editor 而搬入 client。
- `ConfigurationEditor`（419 行）同时处理缺失 capability 初始化、capability toggling/save、environment policy create/update、ETag、effective state、hydration gating 和错误反馈；其 `section` prop 决定子流程。数据加载由 `lib/configuration-api/server.ts` 持有。现有测试分别覆盖展示/依赖/隐私/状态、初始化 POST 与失败、SettingsTaskPage policy unavailable 状态。首轮实现应将 capability 和 environment policy 当作两个相邻子流程，不合并成通用配置框架。
- `IngestKeysManager`（452 行）负责 policy 列表刷新、一次性 secret、create/revoke、响应结构验证、Web Locks 跨 tab 协调、localStorage outcome marker 和 review。现有 `ingest-keys-manager.test.tsx` 已覆盖 stale revoke confirmation、有效列表复核、其他 tab 锁、成功响应 metadata 不完整和 secret 创建后列表刷新失败。此边界具有最高的异步/安全状态复杂度，放在 Definitions 与基础 configuration 切片之后；开工前需单独重查最新行为和缺口。
- API 边界分两类：服务端初始数据由 `lib/configuration-api/server.ts` / `lib/site-management/client.ts` 加载；浏览器变更请求从 editor/manager 调用 Dashboard API routes。Routes/proxy 和 server client 已有各自测试。本工作包只在具体切片确实需要时整理浏览器 API I/O，不移动 server-only client，不重构 routes。
- 不同流程不可混淆的并发语义：Definitions 使用 immutable revision 和 `If-Match`/`If-None-Match`；configuration 使用版本条件更新；Ingest Keys 使用 policy version、one-time secret、跨 tab lock 与持久化 review marker。不可为了减少组件数量而共享这些状态机。

### 推荐顺序与边界

1. **Definitions 编辑器。** 首个实现切片。先抽纯 draft 操作/条件值转换与验证，再集中浏览器 GET/POST/PUT 解释和请求头，最后整理 flow/presenter。保持 Definitions page 和 revision history 不变。此流程边界明确且现有 UI 生命周期测试较完整，适合作为第二个重构试点。
2. **Capabilities 初始化与编辑。** 独立于 Environment policy，保护缺失配置初始化、依赖和必选能力、版本更新及 effective-state 显示。由 `ConfigurationEditor` 的 `section="capabilities"` 分支和 initialize UI 测试覆盖。
3. **Environment/Origins policy。** 保护环境身份、未配置 policy、Origins/rate-limit 输入、create/update 条件头、启停语义与 effective-state。共享 `ConfigurationEditor` 中的数据加载和通用错误视图时，只抽出确实共有的展示代码。
4. **Ingest Keys 生命周期。** 单独规划与实施；先补齐并发交错和 storage 错误测试，再考虑将 validator/API/state/view 拆开。创建和 revoke 的请求不可抽象成同一不区分结果的 mutation，因为其未知结果处理不同。
5. **关闭工作包。** 汇总最终依赖图、入口与 API 兼容性、失败边界、全量测试和按范围选择的 E2E/根级检查，更新 Checklist 和本记录。

### 当前可确认的约束

- 页面入口、search params 透传、Settings section/environment 选择和默认 environment 解析保持不变。
- 所有 user-facing labels、错误/空状态、ARIA、控件禁用条件和路由上下文都要用现有测试作为行为基准；计划拆分不代表可以顺手改变产品文案或导航。
- 将纯值转换/校验与网络 I/O 分别放入本领域模块；每个 presenter 接收显式 props 与回调，不自行访问 URL、storage、navigator locks 或 fetch。
- 每个子切片先跑其定向测试；影响跨流程装配时再跑 Dashboard 全量测试。E2E 和根级 `pnpm check` / `pnpm test` 根据触及边界选择并如实记录。

## 工作包 3.2 Definitions domain 与 API I/O（2026-10-06）

- `components/definition-editor/definition-domain.ts` 持有 conversion/funnel draft、property condition 操作及 dirty 比较；`definition-api.ts` 集中 GET 最新定义、POST 新建、PUT 更新及 HTTP 错误解释。原有 UI 测试保留了新建/更新调用路径、409、验证错误和刷新行为；domain/API 各自有单元测试。
- 页面、API route、server loader 与 revision history 未改动。协议和请求头语义保持原状。

## 工作包 3.3 Definitions flow 与 Presenter（2026-10-06）

- 新增 `components/definition-editor/use-definition-flow.ts`，统一持有 conversion/funnel drafts、baseline、revision/version、pending、error/success、revision conflict 和 reload confirmation；通过既有 API/domain 模块保存或加载，并在保存成功后调用 `router.refresh()`。
- `DefinitionEditor({ siteId, result })` 入口仍负责不可用状态、以 site/revision 为 key 重置编辑器及 site 关联的保存提示。Presenter 通过明确的数据 props 和动作 callbacks 展示视图；draft 更新操作由 flow hook 调用 domain。属性条件视图仍为内部组件。Definitions server page 和 revision history 未迁移。
- 新增 Presenter 测试，验证动作 callback、pending/error/success 展示、已存 ID 锁定和 funnel steps 顺序；原有入口集成测试继续覆盖保存/reload 生命周期。
- 验证：Definitions 定向 Vitest 命令实际执行了 Dashboard 全量测试（46 files、244 tests）并通过；Dashboard typecheck、lint、相关文件 Prettier check 与 `git diff --check` 通过。定向测试包含保存成功后 baseline 更新/refresh、409 保留草稿、dirty reload 确认与取消/确认路径，页面测试继续检查历史版本行为。
- 未运行 Settings E2E、根级 check/test 或 build；本次只改 Dashboard 客户端编辑器及重构记录，已有 UI/API/domain 测试与 typecheck/lint 覆盖本次改动。

## 工作包 3.6 Ingest Keys 生命周期（2026-10-06）

- 新增 `components/ingest-keys/use-ingest-keys-flow.ts`，持有 policy、一次性 secret、busy/error、撤销确认、列表刷新需求及 review 状态；Web Locks、localStorage unknown marker 和跨 tab `storage` event 也由 flow 管理。`IngestKeysManager({ siteId, environment, result })` 保持原入口，只负责 unavailable/no-policy 分流并装配 Presenter。
- 新增 `components/ingest-keys/ingest-keys-presenter.tsx` 展示可用 key 列表、一次性 secret、review 操作及撤销确认。Presenter 通过 props/callback 接收状态与动作，不执行 fetch、storage 或锁协调。
- 保持 validation/API 模块、Dashboard API routes、Settings loader、服务端 client 和 API 请求语义不变；POST/DELETE 仍发送 policy version `If-Match`。创建结果不明时保留 marker；marker 写入失败时不发请求，清理失败时保留 review；撤销结果未知时仅在有效刷新确认 key 已 inactive 后关闭确认。
- 新增测试覆盖 storage 写入失败不签发、模糊创建结果留 marker 且不持久化 secret、无效 policy 刷新不能结束 review、跨 tab 锁冲突、创建成功但列表刷新失败、pending 重复提交保护，以及撤销结果和刷新均无法确认时保留确认。新增 API 测试确认 policy URL、创建 POST、撤销 DELETE、编码 key ID、policy version `If-Match` 和服务端错误反馈；既有测试继续核对 secret 单次展示和 stale revoke recovery。
- 验证：Ingest Keys、SettingsTaskPage 与 API 定向测试 16 项通过；Dashboard 全量测试、typecheck、lint、Prettier 检查和 `git diff --check` 通过。未运行 Settings E2E、根级 Rust/check/test 或 build；此次只触及 Dashboard 客户端 flow/presenter 与测试，既有 Settings 页面集成测试和 Dashboard 检查作为验证。

## 工作包 3.4 Capabilities 与初始化流程（2026-10-06）

- `components/capability-editor/capability-domain.ts` 持有 Page Views 必选和 capability 依赖规则；`capability-api.ts` 集中 create-only 初始化和带 `If-Match` 的更新；`use-capability-flow.ts` 编排初始化/保存、错误反馈及 `router.refresh()`；Presenter 只接收 flow 数据和动作，并展示 runtime effective-state。
- 保留 `ConfigurationEditor` 的稳定入口和 missing-capabilities 分流；未实现 capability 仍禁用，Page Views 始终锁定。初始化 POST 使用 `If-None-Match: *`，更新 PUT 使用当前配置版本 `If-Match`；隐私提示和 runtime 状态展示保留。
- 既有 `configuration-editor.test.tsx`、`configuration-editor.initialize.ui.test.tsx`、`settings-task-page.test.tsx` 与新增 domain/API 测试覆盖依赖阻止、初始化成功/失败、版本条件、禁用项、状态呈现和 Settings 上下文。

## 工作包 3.5 Environment/Origins policy 流程（2026-10-06）

- `lib/environment-policy/domain.ts` 负责 origins 文本归一化、payload 和表单初值；`api.ts` 负责显式 site/environment policy URL、create/update 请求和 `If-None-Match` / `If-Match`；`use-environment-policy-flow.ts` 管理编辑值、pending、错误/成功反馈、刷新和有效状态初值；Presenter 呈现 origins、rate limit、enabled 语义与 effective-state。
- 保留默认 environment 解析和 URL/query context；无 policy 时显示创建状态，未配置或不可用状态继续由 Settings 页面/入口处理。enabled 是保存的 policy 字段；启用不绕过 allowed Origin 与 active Ingest Key 要求，禁用时 Collector 拒绝事件。
- 既有 ConfigurationEditor/SettingsTaskPage 测试及新增 domain/API/Presenter 测试覆盖创建与更新条件头、origins 空行处理、rate limit、无 policy、失败/冲突、保存反馈和 effective-state。

## 工作包 3.7 完整验收与关闭（2026-10-06）

- 静态复核确认 Capabilities、Environment policy、Definitions 和 Ingest Keys 各自持有领域规则/API I/O/流程状态/展示边界；入口组件只负责加载结果分流和装配。Presenter 不持有 fetch、server-only loader、路由或 storage 副作用。模块命名表达实际职责，新增测试位于相应 domain/API/flow/presenter 目录或现有入口集成测试旁。
- Settings page/query context、site/environment 选择、server-only loader/client、API routes/proxy、请求头和后端均未改动；没有把 server-only client 引入浏览器模块。失败状态保留错误反馈；乐观并发冲突继续要求读取/刷新最新配置。Definitions revision/draft、Capabilities effective-state、Environment policy effective-state，以及 Ingest Keys secret/review 边界均有现存测试保护。
- 验证结果：
  - `pnpm --filter @web-analytics/dashboard test`：54 个测试文件、271 个测试通过（包含 effective-state 保存响应回归测试）。
  - `pnpm --filter @web-analytics/dashboard typecheck`：通过。
  - `pnpm --filter @web-analytics/dashboard lint`：通过。
  - `pnpm --filter @web-analytics/dashboard format:check`：通过。
  - `git diff --check`：通过。
  - `pnpm e2e:configuration`：通过（`Configuration E2E workflow passed.`）；E2E runner 已清理该次启动的 Compose 服务、网络和卷。
- 未运行根级 `pnpm check`、`pnpm test`、build 或 Rust 检查：工作包 3 只改 Dashboard 客户端职责拆分、Dashboard 测试和重构记录，没有触及 Rust、共享 packages、API routes、server-only client/loader、存储或后端实现；Dashboard 全量检查加 configuration E2E 已覆盖本切片验收范围。
- 工作包 3.4/3.5 的实现与保护测试、共同不变量、Dashboard 检查及 settings E2E 证据均满足；工作包 3 关闭。
