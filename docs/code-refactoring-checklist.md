# 代码重构执行 Checklist

本文件跟踪 [代码重构路线图](./code-refactoring-roadmap.md) 的工作包。按业务/领域切片推进，一个工作包可以涉及多个相关文件；不以逐文件修改为工作单位。每个工作包应一次覆盖实现、调用方、测试和必要文档，并形成可单独审查的变更。

## 工作包 1：建立基线并设计第一批重构切片

**状态：** 已完成（评审通过；2026-10-06）
**范围：** 盘点、依赖分析、验证基线和拆分设计；本工作包完成前不搬移生产实现。

### 1.1 建立可用的候选清单

- [x] 完整清单：[代码重构候选清单](./code-refactoring-candidate-inventory.md)（扫描日期 2026-10-06；381 个跟踪文件，0 个缺失）。
- [x] 重新统计受版本控制的源代码行数，标明扫描扩展名、排除目录和统计日期。
- [x] 给候选打标签：生产实现、测试、生成代码、实验产物、迁移/fixture、构建/CI tooling。
- [x] 将同一功能涉及的生产代码、直接调用方、相关测试、API/helper 与样式归为同一候选切片。
- [x] 对生成文件、实验代码、历史迁移和大型 fixture 记录“排除 / 单独评估”的理由，不将它们混进生产代码拆分指标。
- [x] 给活跃候选记录：当前职责、主要输入/输出、持有状态、外部副作用、已知调用者和对应测试。

### 1.2 绘制领域依赖和行为边界

- [x] 领域数据流、状态所有权、I/O、副作用、测试位置及依赖方向：[领域依赖和行为边界](./code-refactoring-domain-boundaries.md)。静态无法确认的动态约束已标注待验证；未改变实现或候选排序。

- [x] **Dashboard 创建站点流程：** 页面入口、表单状态、校验/派生、创建请求、能力初始化/替换、失败重试、反馈、子视图和测试已记录。
- [x] **Dashboard 定义/配置/密钥管理：** 状态所有权、API 边界、纯逻辑、子视图、测试及共用/专属职责已记录。
- [x] **Rust runtime/HTTP/API：** configuration-runtime 公开 API、Collector handler/policy/security/rate-limit/sink、Analytics API configuration handler/store/validation 流程及测试位置已记录。
- [x] **Processor：** 解析、归一化、sessionization、聚合/维度、写入、rebuild/backfill 顺序及事务/幂等约束已记录；需动态确认处已标注。
- [x] **E2E：** runner、environment/support、各 suite 的生命周期、浏览器动作、造数、断言、诊断和清理边界已记录；未确认的 finally 行为已标注。
- [x] **契约 tooling：** 命令入口、输入、结构/语义规则、诊断输出及实际共享范围已记录。
- [x] **大型测试、CSS 和其他候选：** HTTP/Processor 测试行为分组、CSS 全局入口和可识别区域已记录；级联细节待验证。
- [x] 每个切片的允许依赖方向、应保持私有的实现和现有公共接口已记录。

### 1.3 记录现有验证基线

- [x] 定向检查命令、上层回归命令、实际执行结果、环境依赖及缺测风险：[验证基线](./code-refactoring-validation-baseline.md)。

- [x] 确认每个候选可用的最小定向测试命令，以及覆盖其调用方的上层命令。
- [x] 记录仓库标准的格式、lint/typecheck、Rust fmt/clippy/test/build 和相关 E2E 命令；区分切片检查与合并前检查。
- [x] 列出已有缺测行为及风险；基线阶段未新增测试，待实际拆分前按需补最小保护测试。
- [x] 记录数据库、Compose、Playwright、环境变量依赖，以及本次未运行项的替代证据和原因。

### 1.4 选择成组试点，而非单文件试点

- [x] 评估并选择创建站点向导作为第一个完整职责切片，范围含创建结果的替换密钥恢复：[试点设计](./code-refactoring-site-creation-pilot.md)。
- [x] 列出计划触及文件/目录和目的；按职责新增模块，不按文件行数切割。
- [x] 明确保持 API 契约、步骤/校验/错误文案、视觉与可访问性、密钥恢复语义不变。
- [x] 记录目标模块树、模块 I/O/状态所有权、依赖方向、状态数据流和测试归属。
- [x] 比较 `DefinitionEditor` / `ConfigurationEditor` 备选项；创建向导边界及已有覆盖更适合作为垂直试点，路线图顺序不变。
- [x] 定义缺失保护测试、验收清单、定向与回归命令及可分开的提交边界。

### 1.5 完成评审

- [x] 依赖图能解释数据流和状态所有权：Dashboard Presenter 不持有远程状态或 I/O；domain logic 保持纯逻辑；API I/O 与 flow 编排分开；Rust handler/use-case/store 依赖方向单向。运行时并发、事务和清理等静态无法确认项仍标为待验证。
- [x] 拆分设计按职责命名模块，不以行数为拆分目标；创建向导目标模块树和状态流见 [试点设计](./code-refactoring-site-creation-pilot.md)。
- [x] 路线图按领域工作包推进；首个试点已定义可分别审查/回退的子边界，并映射关联测试与缺失保护项。后续工作包的具体子边界须在各自实施前细化；创建向导的幂等重试、payload 变化、重复提交等缺口已明确记录，失败诊断和动态风险保留为实施验收项。
- [x] 路线图链接 1.4 试点设计，候选顺序不变，Dashboard 创建站点向导仍为第一候选。
- [x] 工作包 1 关闭；下一项实施任务为工作包 2：Dashboard 创建站点流程。

**工作包 1 完成条件：** 候选清单覆盖活跃大模块；排除项有理由；关键数据流和模块边界已画清；基线命令可复现；第一个多文件领域切片有范围、拆分草图和验收条件。不能仅以生成了一张行数榜单作为完成。

## 后续工作包占位

以下按完整领域切片组织，具体文件清单和拆分边界由工作包 1 的调查结果确定。

### 工作包 2：Dashboard 创建站点流程

**范围与设计依据：** 按[创建站点试点设计](./code-refactoring-site-creation-pilot.md)实施完整创建及结果恢复生命周期；保留 `SiteCreationWizard({ manifest })` 页面入口。API routes、服务端 `site-management` client、数据库和后端行为不在重构范围内。

**实施步骤与独立审查/回退边界：**

- [x] **2.1 实施前复核：** 已静态核对向导、页面入口、admin routes/proxy 与 server-only client、helper/UI/client/proxy 测试及 Dashboard scripts；调用路径、边界、断言缺口、malformed replacement 响应语义和待运行时验证项已记入[试点设计复核记录](./code-refactoring-site-creation-pilot.md#工作包-21-静态复核记录-2026-10-06)。未改生产代码或测试，未运行产品测试。
- [x] **2.2 抽离纯 domain：** 已将 Origin 解析、allowed origins 派生、能力依赖闭包、步骤校验、payload 构造及 API 错误 path 映射迁入 `components/site-creation-wizard/site-creation-domain.ts`；helper 测试迁至 domain 测试并补充校验、payload 顺序与去重断言。Dashboard 定向测试和 typecheck 通过，详见[2.2 实施记录](./code-refactoring-site-creation-pilot.md#工作包-22-纯-domain-抽离-2026-10-06)。
- [x] **2.3 集中 API I/O 与流程状态：** 已新增 `site-creation-api.ts` 集中 create、policy、replacement-key 请求和 HTTP 响应解释；`use-site-creation-flow.ts` 持有表单/步骤/请求/结果/幂等/review 状态并协调 URL 与 storage 副作用。API 模块不依赖 React 或 server-only client；新增 API 解释测试。定向测试、typecheck 和格式检查通过，详见[2.3 实施记录](./code-refactoring-site-creation-pilot.md#工作包-23-集中-api-io-与流程状态-2026-10-06)。幂等边缘流程保护留在 2.4。
- [x] **2.4 补齐流程保护：** 向导 UI 测试已覆盖相同 payload 网络失败重试复用 Idempotency-Key、payload 改变时生成新 key、pending 时重复提交只发一个 POST；覆盖 query 身份恢复不自动请求、storage 写入失败不 POST、malformed 4xx 清 unknown 并允许再次尝试，以及成功状态 malformed/缺 key、5xx 和网络失败保留 review 并阻止重试。请求次数、body、headers、storage marker 和按钮状态均有断言；review 后另修复了 replacement 状态及异步结果按恢复身份隔离的边界。API contract/routes 与用户可见行为不变，见[2.4 实施记录](./code-refactoring-site-creation-pilot.md#工作包-24-补齐流程保护-2026-10-06)。
- [x] **2.5 拆分 Presenter 与步骤/结果视图：** wizard 保留 `SiteCreationWizard({ manifest })` 稳定入口并装配 flow、步骤视图和结果视图；两个视图仅通过 props 接收展示数据和动作，不直接 fetch、不读取 URL/storage、不生成幂等键。保留语义化结构、ARIA、键盘操作、视觉 class 和文案；最终 review 为模糊 replacement 请求增加 pending review 确认保护和 storage 清除失败提示，见[2.5 实施记录](./code-refactoring-site-creation-pilot.md#工作包-25-拆分-presenter-与步骤结果视图-2026-10-06)及[2.6 收尾记录](./code-refactoring-site-creation-pilot.md#工作包-26-切片收尾-2026-10-06)。
- [x] **2.6 关闭切片：** 已检查最终依赖方向、导出面、文件命名、测试归属和失败诊断；未发现搬移后重复实现或无用 helper。记录 review 修复与验证限制，详见[2.6 收尾记录](./code-refactoring-site-creation-pilot.md#工作包-26-切片收尾-2026-10-06)。

**必须保持的不变量：**

- [x] 页面入口与 `POST /api/admin/sites` 契约、payload、Idempotency-Key、201 首次创建与 200 replay 解释不变。
- [x] 步骤顺序、字段/Origin/能力校验、字段错误映射、错误文案、视觉及可访问性不变。
- [x] 首次创建的一次性 key 只在响应页面内存展示；刷新和 replay 不恢复原始 key；replacement key 仍须用户显式触发。
- [x] Replacement 前先读取 policy/ETag；成功只在当前页面显示秘密；明确拒绝可重试；模糊结果保留 unknown 标记、禁止再次签发并要求到 Settings 人工核对。
- [x] 不重构 API routes、服务端 `lib/site-management/client.ts`、持久化或后端；不引入通用表单框架或新的服务端抽象。

**测试映射与新增保护：**

- [x] 保留并迁移 `site-creation-wizard.test.ts` 中 Origin、能力依赖闭包和 API path 映射纯函数覆盖。
- [x] 保留 `site-creation-wizard.ui.test.tsx` 的表单/Origin/字段错误、创建/replay、key 恢复成功及模糊结果/review 行为覆盖。
- [x] 新增或补齐 2.4 列出的幂等重试、payload 更新、重复提交、恢复 query、storage 失败、明确 4xx、malformed/5xx 场景；断言请求次数、请求体/headers 和 review 状态，不仅断言提示文案。
- [x] 确认页面入口及 `lib/site-management/client.test.ts` 的相关覆盖仍适用；切片没有触及这些实现，未做无关改动。

**实施验证命令：**

- [x] 每个子边界运行向导定向测试：`pnpm --filter @web-analytics/dashboard test -- components/site-creation-wizard`。
- [x] 完成实现后运行 `pnpm --filter @web-analytics/dashboard typecheck`、`pnpm --filter @web-analytics/dashboard lint` 和 `pnpm --filter @web-analytics/dashboard test`。
- [x] 运行真实用户链路 `pnpm e2e:site-onboarding`；结果与本次环境记录见 2.6 收尾记录。
- [x] 按变更面完成 Dashboard 检查和 onboarding E2E；未运行覆盖 Rust 与其他 packages 的根级 `pnpm check` / `pnpm test`，也未运行全 workspace build，详见 2.6 收尾记录。

**工作包 2 完成条件：** 目标模块依赖单向、原组件成为稳定薄入口；所有不变量和保护测试满足；定向/回归检查结果及未运行项有记录；页面到创建、replay 和 replacement-key recovery 的用户路径验证完成或明确标记受环境限制。每个子边界都能独立审查和回退，没有无关产品行为变化；按批准范围修复的 replacement 安全边界差异详见 2.6 收尾记录。工作包 2 已按上述记录关闭。

### 工作包 3：Dashboard 定义、配置和密钥管理

- [x] **3.1 实施前复核与切片排序：** 已静态梳理 Definitions、Capabilities、Environments/Origins 和 Ingest Keys 的页面入口、状态/API 所有权、现有测试与关键保护边界；按风险和耦合度排出实现顺序，见[Dashboard 设置流程试点计划](./code-refactoring-dashboard-settings-pilot.md#工作包-31-静态复核与切片排序-2026-10-06)。未修改产品代码或测试，未运行产品测试。
- [x] **3.2 抽离 Definitions 领域规则与 API I/O：** 已提取纯 draft/属性条件操作与浏览器端保存/刷新请求；锁定新建 POST、更新 PUT、`If-None-Match` / `If-Match`、revision 和 validation error 契约，见[试点记录](./code-refactoring-dashboard-settings-pilot.md#工作包-32-definitions-domain-与-api-io-2026-10-06)。
- [x] **3.3 整理 Definitions 流程与 Presenter：** 保留稳定 `DefinitionEditor({ siteId, result })` 入口；新增 flow hook 统一持有 drafts、baseline、冲突/重载确认、pending/error/success 状态并协调 API 与 `router.refresh()`；编辑表单继续通过已存在的显式更新回调执行 draft 操作。按 site/revision 重置、site 关联保存提示、有序 funnel steps、不可变既有 ID、dirty draft 保护及 revision history 页面行为均保留，见[试点记录](./code-refactoring-dashboard-settings-pilot.md#工作包-33-definitions-flow-与-presenter-2026-10-06)。
- [x] **3.4 拆分 Capabilities 与初始化流程：** 隔离 capability 依赖/可用性规则、初始化和带版本保存流程；保留 Page Views 必选、依赖先后约束、隐私说明、`If-None-Match` 初始化、`If-Match` 更新和 runtime effective-state 呈现，详见[试点记录](./code-refactoring-dashboard-settings-pilot.md#工作包-34-capabilities-与初始化流程-2026-10-06)。
- [x] **3.5 拆分 Environment/Origins policy 流程：** 隔离输入归一化/payload 和 policy 创建/更新 I/O；保留 default environment、无 policy 状态、允许来源列表、rate limit、启停语义、ETag 乐观并发及初始化/不可用状态，详见[试点记录](./code-refactoring-dashboard-settings-pilot.md#工作包-35-environmentorigins-policy-流程-2026-10-06)。
- [x] **3.6 整理 Ingest Keys 生命周期：** 新增专用 flow hook 和 Presenter，保留 create/revoke、一次性 secret、跨 tab Web Locks、localStorage unknown marker、列表刷新和模糊结果处理；严格响应验证、ETag 条件写、review 流程与失败时禁止重复签发不变，详见[试点记录](./code-refactoring-dashboard-settings-pilot.md#工作包-36-ingest-keys-生命周期-2026-10-06)。
- [x] **3.7 关闭切片：** 已检查依赖方向、导出面、命名、测试归属、页面/API 契约及错误诊断；Dashboard 全量测试、typecheck/lint/format、diff 检查和配置 E2E 均通过。根级检查与 build 未运行，原因及证据见[试点记录](./code-refactoring-dashboard-settings-pilot.md#工作包-37-完整验收与关闭-2026-10-06)。

**必须保持的不变量：**

- [x] Settings 页面入口、route/query context、site/environment 选择、server-only loader/client 及 Dashboard API 契约不变；不把 server-only client 引入浏览器模块。
- [x] Definitions 保留不可变的已存 ID、转换/漏斗属性类型、漏斗步骤顺序、revision/effective time、冲突处理和未保存 draft 丢弃确认。
- [x] Capabilities 保留 Page Views 必选、依赖规则、尚未实现 capability 的禁用状态和隐私约束；初始化仍为 create-only，更新仍使用版本条件。
- [x] Environment policy 保留显式 environment 身份、Origins/rate-limit/enabled 字段语义、无 policy 空状态及版本冲突保护。
- [x] Ingest Key secret 仅在创建响应页面内存短暂展示；跨 tab 协调、unknown marker、有效列表复核和无法确认时阻止再次签发的行为不变。
- [x] 不重构 API routes、`lib/site-management/client.ts`、server-only loaders、持久化或后端；不引入横向通用 CRUD/form 框架。

**测试映射与新增保护：**

- [x] 以 `definition-editor.test.tsx` 和 `definitions/page.test.tsx` 为基线；补足 domain/API 测试后保留保存、验证错误、revision conflict、reload discard confirm 和历史版本页面行为。
- [x] 以 `configuration-editor.test.tsx`、`configuration-editor.initialize.ui.test.tsx`、`settings-task-page.test.tsx` 为 Capabilities/Environment 基线；验证依赖阻止、初始化及版本头、空/失败状态和刷新数据。
- [x] 以 `ingest-keys-manager.test.tsx` 为安全状态基线；保留跨 tab 锁、marker、无效响应、列表刷新、revoke stale confirmation 和 secret 展示边界，并补 storage 写失败、模糊 create 结果及无法确认 revoke 状态。
- [x] 保留 `lib/configuration-api/*`、`lib/site-management/client.test.ts`、Settings page 与 route/proxy 的既有契约覆盖；只在实际变更边界时扩充，不做无关改动。

**实施验证命令：**

- [x] Ingest Keys 子切片运行 `ingest-keys-manager.test.tsx`、`settings-task-page.test.tsx` 和 `lib/ingest-keys/api.test.ts` 定向测试、Dashboard 全量测试、typecheck/lint/格式检查及 `git diff --check`；结果 16 项定向测试与 270 项 Dashboard 测试通过，typecheck、lint、Prettier 和 diff 检查通过。
- [x] 工作包 3 全部子切片实现后运行 `pnpm --filter @web-analytics/dashboard test` 及 Dashboard typecheck/lint/format 检查；54 个测试文件、271 个测试通过，typecheck/lint/format 均通过。
- [x] 按变更面运行相关 settings E2E；`pnpm e2e:configuration` 通过，覆盖初始化/配置/有效状态和浏览器设置工作流。
- [x] 根据变更面决定是否运行根级 `pnpm check`、`pnpm test` 和 build；本切片只改 Dashboard 客户端/测试与重构文档，根级检查及 build 未运行，详见试点记录。

### 工作包 4：Rust configuration runtime 和服务边界

- [x] **4.1 实施前复核与边界细化：** 已静态梳理 configuration-runtime、Collector HTTP、Analytics API configuration/store 的调用方向、已有测试和公开边界；实施前待确认项及最终动态证据/限制见[Rust 配置重构试点记录](./code-refactoring-rust-configuration-pilot.md#工作包-41-实施前复核-2026-10-06)及 4.6。本步骤未修改 Rust 代码，未运行产品测试。
- [x] **4.2 configuration-runtime 模块化：** 已将 snapshot/schema validator、runtime/refresh 与测试支持分别整理到 `capability_snapshot.rs`、`runtime.rs` 和 `test_support.rs`；`lib.rs` 保留稳定公共 re-export 与 `REFRESH_INTERVAL`。schema、capability/依赖及 activation-window 校验、refresh/stale/report 和后台刷新周期保持不变；定向测试、Clippy、格式与 diff 检查均通过，详见[Rust 配置重构试点记录](./code-refactoring-rust-configuration-pilot.md#工作包-42-configuration-runtime-模块化-2026-10-06)。工作包 4 的整体验收见 4.6。
- [x] **4.3 Collector HTTP 请求边界：** 已将路由组装、事件请求处理、preflight、response/error 与按行为分组的测试整理到 `http/`；保留 `collector::http` 路径及路由构造函数。body/content-type 与 JSON 检查、site/origin/key 授权、限流、capability gate、batch validation、Geo 和 sink 顺序及错误映射经静态复核与定向测试确认，详见[Rust 配置重构试点记录](./code-refactoring-rust-configuration-pilot.md#工作包-43-collector-http-请求边界-2026-10-06)。Collector PostgreSQL 集成及 configuration E2E 验收见 4.6。
- [x] **4.4 Analytics API configuration handler：** 已按资源整理 capability/policy/key/definition 请求处理，并归组 precondition、输入/存储校验、response/ETag、错误映射等共享职责及相关测试；route、HTTP 契约和一次性密钥语义保持不变，验证与未运行项见[Rust 配置重构试点记录](./code-refactoring-rust-configuration-pilot.md#工作包-44-analytics-api-configuration-handler-2026-10-06)。
- [x] **4.5 Analytics API configuration store：** 已按 capabilities、environment policy/key、applied-state 查询和 definition revisions 拆分 `config_store.rs`；façade 保留调用接口、共享类型与错误映射，SQL/事务/锁/audit 顺序及存储语义不变。定向验证与环境限制见[Rust 配置重构试点记录](./code-refactoring-rust-configuration-pilot.md#工作包-45-analytics-api-configuration-store-2026-10-06)。工作包 4 的整体验收见 4.6。
- [x] **4.6 整体验收与关闭（2026-10-06）：** 已复核依赖方向、导出面、错误映射、测试归属及 diff；`pnpm check`、`pnpm test`、`pnpm build`、完整 `pnpm test:integration`（在隔离 E2E PostgreSQL 上）和 `pnpm e2e:configuration` 均通过。refresh 生命周期经调用点/循环结构复核并由集成/E2E 运行覆盖；Tokio task cancellation/shutdown 时序没有专门测试，详见试点记录。完整结果、环境说明与静态边界结论见[Rust 配置重构试点记录](./code-refactoring-rust-configuration-pilot.md#工作包-46-整体验收与关闭-2026-10-06)。工作包 4 关闭。

**必须保持的不变量：**

- [x] `configuration-runtime` 继续提供现有公共类型与方法；Capability schema、site/version 身份、Page Views 必选、implemented/dependency 规则和 activation windows 校验不变。
- [x] Runtime 刷新仍保留最后有效 snapshot；数据库读取失败、单 Site 文档无效、stale 状态和 applied-state 报告的现有语义不变。`REFRESH_INTERVAL` 和后台 task 生命周期不得因模块移动改变。
- [x] Collector 的 route、request/response/status/error、body 限制、CORS、安全策略、rate limit 和事件拒绝/接收顺序不变；batch 不得部分写入。
- [x] Analytics API 保留 `If-Match` / `If-None-Match`、ETag、验证错误结构、effective-state response、一次性 Ingest Key 返回及 key digest 存储语义。
- [x] Store 的事务、版本控制、审计、Origin 唯一性、定义 immutable revision/既有 ID 保留及回滚行为不变；不修改数据库 schema 或历史 migration。
- [x] 依赖方向保持为 HTTP adapter/handler → runtime、领域服务和 store；runtime/store 不依赖 Axum handler；未扩大 crate/service 公共 API。

**测试映射与新增保护：**

- [x] 保留 `configuration-runtime` 的 snapshot/schema/activation-window 单测；Collector 与 Analytics API shared runtime stale/applied-state 调用覆盖通过 PostgreSQL 集成测试。
- [x] 保留 Collector HTTP handler、`tests/http_ingestion.rs` 和 `tests/runtime_policy_postgres.rs` 对请求顺序、安全策略、拒绝行为及 runtime policy 的覆盖；workspace 与 integration 测试通过。
- [x] 保留 Analytics API configuration handler/store 单测、`tests/module_boundaries.rs` 及 `tests/http.rs` 的 configuration admin/API、ETag、transaction、audit、key 和 definition revision 覆盖；workspace 与 PostgreSQL integration 测试通过。
- [x] 拆分后的测试按行为域归组，fixture/setup 接口清晰；未引入通用测试框架。

**实施验证命令：**

- [x] 子切片 crate 定向测试均已记录；最终 workspace test 与 PostgreSQL integration 覆盖通过。
- [x] `pnpm check`、`pnpm test`、`pnpm build` 通过；`pnpm check` 中 5 条 generated protocol unused-disable warning，无 errors。
- [x] `pnpm test:integration` 完整通过：Collector 9 项、Processor 17 项、Analytics API 15 项；使用隔离 E2E PostgreSQL、migration 后运行，未连接本地开发数据库。
- [x] `pnpm e2e:configuration` 通过，覆盖配置工作流；运行器已清理隔离 Compose 服务、数据卷和网络。

### 工作包 5：Rust Processor 流水线

- [x] **5.1 实施前复核与拆分设计（2026-10-06）：** 已静态盘点普通 event、definitions、explicit fact rebuild、generation rebuild/rollback、rebuild queue 的入口/依赖、事务与锁边界；整理 16 个 PostgreSQL processor cases 和 canonical fixture 的行为映射，确定建议模块树、私有边界及验证命令。实施前逐操作 transaction inventory 和待运行时保护项见[Rust Processor 流水线试点记录](./code-refactoring-rust-processor-pilot.md)。本步骤未改生产实现，未运行测试。
- [x] **5.2 事件处理与事实写入拆分：** `event_processing.rs` 负责单事件事务编排、capability snapshot、按 `received_at` 加载 definitions revision、facts 调用与 commit；`event_facts.rs` 收拢 Page View、Custom Event / Conversion / Funnel、Web Vital facts 及关联 watermark 写入。事件 facts 函数只接收显式 transaction；`process_all_once` 顺序仍为 raw events 后 rebuild queue。加固失败回滚用例，使 Page View 聚合已写入后在 rebuild enqueue 约束处失败，并断言聚合、队列和 `processed_at` 全部回滚。行为映射、文件边界、命令及数据库执行限制见 [5.2 实施记录](./code-refactoring-rust-processor-pilot.md#工作包-52-事件处理与事实写入拆分-2026-10-07)。
- [x] **5.3 Generation rebuild / rollback 拆分（2026-10-07）：** 新增 `generation_rebuild.rs` 收拢 enqueue/queue claim、generation build/activate/retire、watermark/rollup/fact helpers、失败记录与 rollback；queue claim transaction 和 generation transaction 仍分离，site advisory lock、generation 状态切换及 queue completion 仍处原事务位置。新增 PostgreSQL 回归用例，直接覆盖新 generation 已写入 normalized context 后、visitor fact 写入失败时的事务回滚：旧 generation 仍 active，事务外记录 failed generation，失败 generation 无残留构建事实。此前 `cargo test -p processor --lib` 8 项、Processor PostgreSQL suite 16 项与 canonical fixtures 1 项在隔离 E2E PostgreSQL 通过；本次新增的第 17 个 PostgreSQL case 因本环境未配置 `DATABASE_URL` 未能执行。完整 `pnpm test:integration` 未运行成功：此前 pnpm 在启动 integration script 前报 `unable to open database file`。静态事务/SQL 顺序及未运行项见 [5.3 实施记录](./code-refactoring-rust-processor-pilot.md#工作包-53-generation-rebuild--rollback-拆分-2026-10-07)。
- [x] **5.4 Explicit rebuild 与 definitions 生命周期拆分（2026-10-07）：** 新增 `explicit_rebuilds.rs` 收拢 conversion/funnel、custom event、Geo、Web Vitals rebuild 与指定 definitions version 的 rebuild 编排；`definition_revisions.rs` 收拢 import-if-empty 和按 `received_at` 读取 revision。保留 `Processor` 公共方法、SQL 与事务顺序、site advisory lock、watermark 清除/推进、capability gate 和 explicit backfill 范围。补充 PostgreSQL 用例直接验证 custom event facts rebuild、指定版本下 conversion/funnel facts rebuild 和 Web Vitals 最新 report sequence/watermark；lib tests 8 项通过，18 项 PostgreSQL target 编译通过。因缺少 `DATABASE_URL`，PostgreSQL 用例及 `pnpm test:integration` 尚未执行。细节见 [5.4 实施记录](./code-refactoring-rust-processor-pilot.md#工作包-54-explicit-rebuild-与-definitions-生命周期拆分-2026-10-07)。
- [x] **5.5 Processor PostgreSQL 测试按行为域重组：** 18 个 Processor PostgreSQL cases 按事件处理、显式 rebuild/definitions、generation/queue/rollback 归组；共享 setup、site/capability seed、raw event fixture 和 cleanup 位于 `tests/processor/support.rs`。`tests/processor.rs` target 名称及 ignored 串行运行方式保持不变；canonical fixture suite 保持独立 target。完整数据库验收的执行证据见 [5.6 整体验收记录](./code-refactoring-rust-processor-pilot.md#工作包-56-整体验收与关闭-2026-10-07)。
- [x] **5.6 整体验收与关闭（2026-10-07）：** 静态复核确认 Processor crate 公共导出与方法签名、事务与锁顺序、失败回滚及测试 target 归属未改变；review 后将 site advisory-lock SQL helper 移入 `queries.rs`，锁 SQL 和事务调用语义保持不变。Processor lib、两个 integration target 编译、Rust 格式、diff 检查、workspace `pnpm check` / `pnpm test` / `pnpm build` 和 `pnpm e2e:analytics` 均通过。首次未设置 `DATABASE_URL` 的 integration 调用提前退出；随后在隔离 E2E PostgreSQL 上重跑 `pnpm test:integration` 完整通过，43 项数据库集成测试通过。详细命令、计数及限制见 [Rust Processor 流水线试点记录](./code-refactoring-rust-processor-pilot.md#工作包-56-整体验收与关闭-2026-10-07)。工作包 5 关闭。

**必须保持的不变量：**

- [x] Raw event 不可变；event identity/idempotency、收到时间排序、processing 标记和 retry/error 行为不变。解析与归一化不产生数据库副作用。
- [x] Site advisory lock、每个事务的 SQL 顺序、失败 rollback、definition-revision lock、queue claim/complete/fail/pause 语义不变；不同 Site 不互相污染。
- [x] Generation 继续完整构建后原子激活，旧 generation 可按现有规则保留/回滚；公开查询不能观察到半成品。watermark 和 daily rollup 值不变。
- [x] Capability enabled/activation window 对 page view、visitor/session、dimensions、conversion/funnel、custom event、Geo、Web Vitals 的 gates 与事实生成行为不变；explicit backfill 仍按当前 scope/版本约束执行。
- [x] Definitions 版本、effective time、import-if-empty 和不可变 revision 规则不变；不修改数据库 schema、migration、CLI 参数、crate 公共 API 或 API 行为。
- [x] 依赖方向为输入解析/归一化与纯 sessionization → 事件/重建领域逻辑 → Processor 编排 → queries/store；SQL helpers 不反向依赖业务编排，纯阶段不依赖 PgPool。site advisory-lock helper 位于 `queries.rs`。

**测试映射与保护：**

- [x] 保留 `services/processor/src/{parser,normalizer,sessionizer,definitions}.rs` 的纯逻辑测试及 canonical protocol fixtures。
- [x] 保留数据库测试覆盖：event 原子处理与重复执行、received-at/definition revision 顺序、UTC 日界与跨 Site 隔离、capability pause/resume、late event 与 explicit backfill、generation queue 并发去重、失败不推进标记、完整 rebuild、Geo rebuild、rollback 和定义导入幂等。
- [x] 静态复核发现 generation transaction 部分写入后的 rollback 缺少直接断言，已补充 PostgreSQL 回归用例；未扩大业务语义。

**验证命令：**

- [x] `cargo test -p processor --lib` 及必要的行为域定向测试通过。
- [x] `pnpm test:integration`：Processor 主 suite 与 canonical fixture suite 在迁移 PostgreSQL 上通过；保留串行运行。
- [x] `pnpm check`、`pnpm test`、`pnpm build` 通过；E2E 也已通过。
- [x] `pnpm e2e:analytics` 通过，验证 Processor 生成数据可经 Analytics API / Dashboard workflow 查询。

### 工作包 6：E2E suite 与契约 tooling

- [ ] 将大型 suites 按端到端场景分组，保留 runner 生命周期、清理和失败诊断。
- [ ] 将 contract validators 按输入合同和校验职责模块化，保留 CLI/package 命令。
- [ ] 评估迁移测试 shell 与 Rust 测试的职责重叠，确认单一清楚的入口。
- [ ] 运行相应 E2E、contract、格式和静态检查。

### 工作包 7：剩余大型测试、CSS 和候选复核

- [ ] 按基线结论处理 HTTP/processor tests、CSS 和其他活跃代码候选。
- [ ] 对生成代码、实验目录、迁移和 fixture 依照其维护方式单独决定。
- [ ] 为每项候选记录拆分、保留或延后结论及依据。
- [ ] 回顾重构是否改善局部理解和修改范围；若只是增加文件跳转则调整边界。
