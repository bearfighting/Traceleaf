# Dashboard 创建站点重构试点设计

本设计对应[代码重构 Checklist 1.4](./code-refactoring-checklist.md)，选择 Dashboard 创建站点向导作为首个多文件重构试点。工作包 1.4 只确认范围和目标边界，不搬移生产实现。

## 工作包 2.1 静态复核记录（2026-10-06）

本节依据当前源码、测试和 package scripts 静态核对；没有运行产品测试或 E2E，因此不代表运行时验证。

- 页面入口确为 `app/dashboard/sites/new/page.tsx`：服务端页面读取 capability manifest 并传给 `SiteCreationWizard({ manifest })`。向导本身通过 `useSearchParams()` 读取 `site_id`、`environment`，恢复时直接进入结果步骤；新建时从步骤 0 开始，步骤顺序为站点详情、环境与 Origins、Capabilities、Review，结果步骤编号为 4。
- `site-creation-wizard.tsx` 目前同时拥有表单/步骤/错误/请求状态、capability 派生、create payload 和 Idempotency-Key、浏览器 fetch、`history.replaceState`、replacement-key policy/ETag 请求、`localStorage` review 标记及所有视图。Origin 解析、能力依赖闭包和 API path 字段映射是同文件导出的纯 helper；测试目前仍从组件模块导入它们。
- 创建请求发往 Dashboard `POST /api/admin/sites`，包含 JSON body、`Content-Type`、`Idempotency-Key` 和 `cache: no-store`。相同序列化 payload 复用 state 中的 key；payload 改变时生成新 key；`createInFlight` ref 在单组件实例内拦截并发提交。201 响应保存 key 到页面 state 并写入身份 query；200 响应只保存 site ID 为 replay 并写入 query。网络或 JSON 解析异常保留 idempotency state 以供再次提交。上述重试及并发细节只有实现依据，现有 UI 测试没有对应断言。
- replacement 流程先 GET policy，读取 `ETag`，成功写入 unknown marker 后才 POST ingest-keys 并发送 `If-Match`。storage 写入失败会在 POST 前退出；状态恢复时 marker 读取失败则按“无需 review”处理。key POST 的非 5xx 错误先视为明确拒绝并清除 marker；网络错误、5xx、成功状态的无效 JSON/缺 key 会保留 review。用户点击“已检查”会清 marker 并解锁重试。对 storage 不可用和 marker 读取异常等策略目前只有源码依据，没有向导测试保护。
- 三个相关 Dashboard routes 均调用 `proxyConfigurationRequest`，不调用 server-only `lib/site-management/client.ts`。proxy 注入服务端 admin bearer token，转发 content-type 及 `If-Match`、`If-None-Match`、`Idempotency-Key`，按方法对写请求校验 same-origin；响应保留状态码、content-type、ETag，并加 `Cache-Control: no-store`。已有 `lib/configuration-api/proxy.test.ts` 覆盖创建请求的 idempotency header、代理路径和其他 proxy 边界；route 文件没有各自独立测试。
- server-only site-management client 是后端服务访问边界，向上游注入 bearer token/Accept、无缓存请求，创建时转发 Idempotency-Key 并区分 201 首建和不含秘密的 200 replay。`client.test.ts` 有创建 header、replay metadata-only、首建 key 格式校验等断言。向导浏览器代码不导入该 client。
- helper 测试只有 Origin scheme/URL 示例、能力依赖闭包和三种 JSON Pointer path 映射。UI 测试保护 Origin 更新/保留、422 字段错误与表单值、201 key 仅结果页展示、200 replay 不显示 key、query 恢复不自动请求、replacement 成功后禁用、policy 404 不创建环境，以及 network ambiguous 后持久化 review。测试没有明确保护 step 字段校验完整规则、replay query 的 URL 编码、policy ETag 到 key POST 的调用顺序/头值、storage 写入失败、replacement 4xx/malformed/5xx、create 幂等重试与并发双击。

### 复核后的保护缺口与待验证项

已有实现行为与下面的目标边界大体一致；实现切片前需按缺口表补测试。特别是“malformed 响应需 review”需按来源区分：replacement POST 的成功状态 malformed 响应保留 review；明确 4xx 即使响应体 malformed 也已按明确拒绝清 marker。该 4xx 语义应由测试锁定，不应笼统要求所有 malformed 响应都 review。

- **已由测试保护：** helper 的代表性规则；UI 中列明的表单错误、创建/replay、恢复和 replacement 生命周期场景；proxy 与 server client 的部分请求头、状态码和响应约束。
- **有代码依据但缺少向导测试保护：** 相同 payload 重试复用 key、payload 改动更新 key、并发提交只发一个请求；replacement policy ETag 顺序、storage 失败不 POST、明确 4xx 可复试、成功状态 malformed/5xx 进入 review、URL 身份编码与 storage 读取失败策略。
- **仍待运行时验证：** 实际浏览器导航/刷新后的 URL 与历史行为、Compose 后端对 200/201 和 ETag 的端到端配合、真实 storage 策略及 onboarding 用户链路。静态审查不替代 Dashboard 测试或 `pnpm e2e:site-onboarding`。

Dashboard package scripts 确认存在 `test`、`typecheck`、`lint`；根 package scripts 确认存在 `e2e:site-onboarding`。试点设计所列定向 Vitest 命令使用 Dashboard 的 `test` 脚本并匹配两个 wizard 测试文件。按 2.1 计划，本次未运行这些命令。

## 工作包 2.2 纯 domain 抽离（2026-10-06）

- 新增 `components/site-creation-wizard/site-creation-domain.ts`，集中纯 Origin 解析、allowed Origins 派生、能力依赖闭包、step 校验、payload 构造和 API path 字段映射；不依赖 React、浏览器 I/O 或副作用。
- 向导继续持有请求和状态，只调用 domain 函数；保留原 API endpoint、headers、序列化 payload 字段顺序和值，以及已有字段错误文案。
- 原 helper 测试迁至 `site-creation-wizard/site-creation-domain.test.ts`，保留原断言，并覆盖校验文案、Origins 去重/顺序、trim 和 manifest capability 顺序。
- 验证：`pnpm --filter @web-analytics/dashboard test -- components/site-creation-wizard` 通过（Vitest 43 个测试文件、219 个测试）；Dashboard `typecheck` 通过。E2E 未运行，流程保护仍由工作包 2.4 处理。

## 工作包 2.3 集中 API I/O 与流程状态（2026-10-06）

- 新增 `components/site-creation-wizard/site-creation-api.ts`，集中创建请求与 201 created/200 replay 解释、字段错误映射、policy/ETag 查询和 replacement-key 请求；保留现有 URL、headers、`no-store` 缓存策略及用户可见错误文案。
- 新增 `use-site-creation-flow.ts`，迁入表单、步骤、校验、pending/error、创建/replay、幂等键、replacement key 与 review 状态。`useSearchParams`、`history.replaceState` 和 `localStorage` 均由流程 hook 协调；`SiteCreationWizard({ manifest })` 入口及 JSX 结构/文案保持不变。
- 新增 API 测试，覆盖 create/replay 状态区分与请求契约、字段路径映射、policy ETag 传递及 replacement 请求 URL/header。API 模块无 React、Next 或 server-only client 依赖；既有 UI 生命周期测试继续通过。
- 验证：`pnpm --filter @web-analytics/dashboard test -- components/site-creation-wizard` 通过（Vitest 44 个测试文件、222 个测试）；`pnpm --filter @web-analytics/dashboard typecheck` 通过；相关文件 Prettier 检查通过；`git diff --check` 通过。
- 未运行 E2E、完整 lint 或 Dashboard 全量测试。相同 payload 重试、payload 修改、快速重复提交、storage 不可用及 replacement 4xx/malformed/5xx 专项保护仍归工作包 2.4；真实 Compose/browser 链路仍待 E2E 验证。

## 工作包 2.4 补齐流程保护（2026-10-06）

- 在现有向导 UI 测试中补齐创建请求保护：网络失败后相同 payload 的重试复用 `Idempotency-Key` 和请求 body；返回失败后修改 Website URL 会改变 body 并生成新 key；请求 pending 时连续点击只产生一个 POST。
- 补齐恢复与 replacement 生命周期保护：编码后的 `site_id` / `environment` 从 query 恢复到结果页且加载时不 fetch；localStorage `setItem` 抛错时仅请求 policy，不发送 ingest-key POST；malformed 4xx 清除 unknown 标记并可再次尝试；成功状态 malformed、缺少 key、malformed 5xx 及既有网络失败用例保留 unknown 标记并禁用再次签发。
- 响应分类沿用现有实现，未发现需要修正的 API 响应分类缺陷。随后 review 发现同一组件切换恢复身份时可能短暂沿用旧身份的 loaded/review 状态；现将 loaded 状态关联到具体 storage marker key，并增加身份切换 UI 覆盖。未更改页面入口、API 契约、API routes 或用户可见行为。未拆分 Presenter/步骤视图。
- 验证：Dashboard 定向测试通过（44 个测试文件、231 个测试）；Dashboard `typecheck` 和 `lint` 通过；相关文件及本记录/Checklist 的 Prettier 检查通过，`git diff --check` 通过。
- `pnpm e2e:site-onboarding` 通过：包含 Page View 计数、Dashboard 管理凭据缺失/无效及 Site Management API 不可用状态、空 Dashboard onboarding、一次性 key、Browser SDK ingest、runtime application、processing、Analytics API 和 Settings evidence。Compose 服务及测试数据已由 runner 清理。
- 最初 Dashboard `lint` 报出 26 条 import 分组/顺序及语句间空行问题；应用 ESLint 自动修复后发现 hook effect 中同步更新状态的规则提示，并移除了入口组件未使用的 `selected` 解构。保留有效身份下先读取 marker 再开放操作的行为，以局部说明抑制必要的同步状态规则提示，Dashboard `lint` 通过。

## 工作包 2.5 拆分 Presenter 与步骤/结果视图（2026-10-06）

- `site-creation-wizard.tsx` 收敛为稳定入口和装配层：调用 `useSiteCreationFlow(manifest)`，并把状态与动作通过 props 传给 `SiteCreationSteps` 或 `SiteCreationResultView`。
- 新增 `site-creation-steps.tsx` 承载四步表单/复核视图；新增 `site-creation-result.tsx` 承载创建、replay、刷新恢复和 replacement review 结果视图。视图只消费受控 props、发出回调，不直接访问 fetch、search params、history 或 localStorage，也不创建幂等键。
- 保持原 DOM 层级、语义元素、`aria-label` / `aria-current` / `role` / 按钮禁用状态、CSS class、链接属性与用户文案；未改页面入口、flow、API contract/routes 或数据行为。
- 后续全面 review 又发现恢复身份切换期间的异步状态串用风险。replacement key、错误、review decision 和 pending 状态现按 storage marker key 分别保存在内存状态中；旧身份请求完成只更新旧身份的结果，不能覆盖当前身份状态。新增两个 UI 测试，覆盖旧身份请求成功/模糊失败时切换身份，以及两个身份请求并行完成后的密钥归属。
- 验证：向导定向测试通过（44 个测试文件、233 个测试）；Dashboard typecheck、lint、相关文件 Prettier 检查及 `git diff --check` 通过。E2E 未因纯视图迁移重跑；工作包 2.4 的 onboarding E2E 已通过。

## 工作包 2.6 切片收尾（2026-10-06）

- 最终依赖方向为页面 → 稳定向导入口 → flow hook → domain/API；向导入口只装配 hook 与 Presenter。Presenter 只接收 props 并发出回调，domain 不含 I/O，API 模块不依赖 React 或 server-only client。模块没有 barrel 导出；内部具名导出只供 wizard 装配、hook/API 间调用和测试使用，没有扩大 Dashboard 公共入口。
- 页面 `app/dashboard/sites/new/page.tsx` 保持原有页面布局和 `DashboardHeader`，并加载 capability manifest 后调用 `SiteCreationWizard({ manifest })`。routes、服务端 site-management client、持久化和后端未改。helper 已迁至 domain 模块，未发现搬移后重复实现或无用 helper；测试按纯 domain、API 和用户可见 flow 分别归属。
- 最终 review 修复了三处恢复安全边界：异步 replacement 状态按 site/environment storage key 隔离；replacement 请求 pending 时不能确认 review；`localStorage.removeItem` 失败时保留 review 锁并显示错误。新增 UI 覆盖身份切换、并发请求归属、pending 确认和 storage 清除失败。
- 不变量复核：创建 payload/Idempotency-Key 与 201/200 解释、表单步骤和校验、key 只在页面内存展示、replacement 显式触发与错误分类均由现有及新增测试保护；E2E 用户链路检查通过。未改变 API 契约或正常用户路径；按范围修正了两个失败边界的行为：请求 pending 时不能确认未知结果，storage 无法清除 review 标记时不能解锁重试并会显示错误。未发现其他行为差异。
- 验证：Dashboard 定向测试及全量测试均通过（44 个测试文件、234 项）；Dashboard typecheck、lint、相关文件 Prettier 和 `git diff --check` 通过；`pnpm e2e:site-onboarding` 通过，覆盖真实 onboarding 及 ingest/processing/settings 链路。
- 未运行根级 `pnpm check` / `pnpm test` 和全 workspace build：本切片仅修改 Dashboard 向导及文档，Dashboard 全量检查和 onboarding E2E 已覆盖变更面；根级脚本还会运行 Rust workspace 与其他 package 的检查。E2E 本次使用 Docker 构建/启动所需服务，runner 完成后清理测试服务与数据。
- 收尾结论：依赖边界、稳定入口、流程不变量、测试归属和验证记录均满足工作包 2 完成条件；工作包 2 关闭。

## 选择依据

创建流程从 `/dashboard/sites/new` 页面进入，当前 `SiteCreationWizard` 集中持有向导状态、异步请求、纯规则和全部视图；其 API route、服务端 `site-management` client、纯 helper 测试及 UI 生命周期测试已形成可追踪的垂直切片。一次重构可以验证状态编排、纯逻辑、I/O 与步骤/结果展示的分工，并以现有行为测试作为迁移基准。

`DefinitionEditor` 和 `ConfigurationEditor` 是备选。前者涉及编辑、校验和保存，后者涉及能力配置、初始化及兼容行为；它们同样有测试，但不如创建向导直接覆盖页面入口、完整多步状态迁移和首次凭据恢复的生命周期。因此不改变路线图排序，也不把两个编辑器纳入本试点。

## 范围与行为约束

范围包含站点创建向导的完整生命周期：站点信息和字段校验、Origin 管理、能力依赖闭包、请求 payload、创建请求与幂等重试、错误字段映射、结果/replay 展示，以及创建结果页中的替换 Ingest Key 恢复（policy/ETag 读取、一次性 key 请求、模糊结果标记和用户复核）。替换密钥恢复纳入范围，因为它与结果页共享站点/环境身份、凭据展示和离开页面后的恢复生命周期。

重构须保持以下行为不变：

- `POST /api/admin/sites` 请求及服务端 API 契约、请求 payload、Idempotency-Key 头和 201/200 结果解释。
- 步骤顺序、字段校验规则、能力依赖规则、Origin 归一化规则和 API 字段错误映射。
- 用户可见错误文案、步骤/结果内容、视觉样式、键盘与屏幕阅读器可访问性。
- 初始 key 只在创建响应所在页面内存展示；刷新或 replay 不恢复原始密钥；替换 key 仍须显式触发。
- 替换 key 请求前读取当前 policy/ETag；请求结果不明确时阻止再次签发，直到用户检查 Settings 中的 key 列表并确认。
- 现有 Dashboard API routes、`lib/site-management/client.ts` 服务端边界、持久化及后端行为。

## 计划触及范围

| 当前文件/目录                                                                                                                                                              | 计划用途                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/dashboard/components/site-creation-wizard.tsx`                                                                                                                       | 保留兼容的 `SiteCreationWizard({ manifest })` 入口，收敛为流程容器及组件装配。           |
| `apps/dashboard/components/site-creation-wizard/`（新增）                                                                                                                  | 创建向导私有模块：状态/异步流程、纯规则、API I/O、步骤视图和结果视图；具体文件树见下节。 |
| `apps/dashboard/components/site-creation-wizard.test.ts`                                                                                                                   | 将纯规则测试迁移/扩展到 domain 模块旁，保持 Vitest 发现路径或同步调整脚本引用。          |
| `apps/dashboard/components/site-creation-wizard.ui.test.tsx`                                                                                                               | 保持用户可见流程测试，按职责拆分后继续覆盖页面流程与替换密钥恢复。                       |
| `apps/dashboard/app/dashboard/sites/new/page.tsx`                                                                                                                          | 只作为页面入口和 manifest 注入点；预期无需行为改动。                                     |
| `apps/dashboard/app/api/admin/sites/route.ts`、`apps/dashboard/app/api/admin/sites/[siteId]/environments/[environment]/ingest-policy/route.ts`、`.../ingest-keys/route.ts` | 保留既有 HTTP 边界；只有发现测试/契约缺口时为保护行为增加测试，不重构 route。            |
| `apps/dashboard/lib/site-management/client.ts`、`client.test.ts`                                                                                                           | 保留服务端 client 边界与现有覆盖；本试点不改其实现。                                     |

`...` 表示完整路径分别为 `apps/dashboard/app/api/admin/sites/[siteId]/environments/[environment]/ingest-policy/route.ts` 和 `apps/dashboard/app/api/admin/sites/[siteId]/environments/[environment]/ingest-keys/route.ts`。当前组件直接 `fetch` Dashboard routes；将浏览器请求集中到向导域 API 模块，不将 server-only 的 `site-management` client 导入客户端代码。

## 目标模块树与职责契约

```text
apps/dashboard/components/
├── site-creation-wizard.tsx              # 稳定入口/薄容器
└── site-creation-wizard/
    ├── use-site-creation-flow.ts          # 表单与流程状态、动作、异步编排
    ├── site-creation-domain.ts            # 纯转换、校验、能力派生、错误字段映射
    ├── site-creation-api.ts               # 浏览器端 Dashboard API I/O 与响应解释
    ├── site-creation-steps.tsx            # 步骤条及详情、环境/Origins、能力、复核视图
    ├── site-creation-result.tsx            # 创建/replay/恢复结果及凭据恢复视图
    ├── site-creation-domain.test.ts        # 纯逻辑测试
    └── site-creation-flow.test.tsx         # 容器流程测试（可并入现有 UI 测试文件）
```

新增文件名是目标职责名；若实现时测试工具或现有组件惯例要求不同文件组织，可调整路径，但不可合并职责边界或改变公共入口。

| 模块                        | 输入                                                        | 输出                                                              | 状态/副作用所有者                                                                                                    | 允许依赖                                                    | 测试归属                          |
| --------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| `site-creation-wizard.tsx`  | capability manifest                                         | 向导 React 树                                                     | 无领域状态；页面级装配                                                                                               | flow hook、步骤/结果视图                                    | 页面入口或轻量渲染覆盖            |
| `use-site-creation-flow.ts` | manifest、search params/恢复身份、用户动作                  | 受控视图状态和动作回调                                            | 表单、step、请求 pending/error、created/replay、幂等键、替换 key 与 review 状态；协调历史 URL 更新及恢复标记生命周期 | domain、API 模块、React hooks；不含 JSX 视图细节            | 流程/状态迁移测试                 |
| `site-creation-domain.ts`   | 字符串、表单值、manifest、API 错误路径                      | Origin、能力集合、字段错误、校验结果、payload                     | 无状态、无 I/O                                                                                                       | 类型/标准 URL API                                           | 纯函数单测                        |
| `site-creation-api.ts`      | 创建 payload/key；站点/环境身份                             | 创建 created/replayed 结果或具语义的错误；替换 key 与 policy 数据 | 不持有 UI 状态；只负责 fetch、HTTP 响应解析及 route path/headers                                                     | 浏览器 fetch 和本域类型；不依赖 React 或 server-only client | API 模块测试或流程 fetch mock     |
| `site-creation-steps.tsx`   | 当前步骤、字段值/错误、派生 Origins/capabilities、动作回调  | 可访问的步骤与表单视图                                            | 不持有远程/领域状态；可保留输入控件所需的局部呈现状态                                                                | UI primitives、明确 props                                   | UI 行为/可访问性测试              |
| `site-creation-result.tsx`  | 站点/环境、创建或 replay/恢复状态、key、提示/错误、动作回调 | 结果与凭据恢复视图                                                | 不访问 fetch/localStorage；只呈现状态并发出用户动作                                                                  | UI primitives、Next Link、明确 props                        | replay、恢复、复制/提示等 UI 覆盖 |

依赖方向为 `page → wizard → flow → domain/API`，并由 wizard 将 flow 的 view model/actions 传给 steps/result。纯 domain 不依赖 React；API I/O 不依赖 UI；Presenter 不发请求、不读取 URL/localStorage、不生成幂等键。替换请求结果标记由 flow 编排、API 模块执行请求；`localStorage` 和 `history.replaceState` 的访问应封装在 flow 可测的窄边界中。不得引入通用表单框架或新的服务端抽象。

## 数据与状态流

1. 页面传入 manifest；flow 从 `site_id`、`environment` 搜索参数判定新建流程或恢复结果页，初始进入步骤 0 或结果步骤。
2. 用户输入由 flow 更新；domain 派生 website Origin、去重后的 allowed origins、依赖闭包能力，并按现有步骤校验规则给出字段错误。
3. Review 提交时 flow 生成与现有实现相同的序列化 payload。若 payload 与上次相同，复用已有幂等键；payload 改变则生成新键。API 模块 POST `/api/admin/sites` 并解释 201 首次创建、200 replay 与失败响应。
4. flow 更新创建/replay 状态并将站点和环境写入现有 query 参数；result view 根据状态显示一次性 key 或不可恢复提示。
5. 恢复动作先读取对应 policy 和 ETag；成功后在发出 key POST 前写入 `localStorage` unknown 标记。响应明确拒绝时清标记并允许重新尝试；网络/5xx/无效响应等模糊结果保留标记、阻止重试并要求用户到 Settings 核对。成功接收 key 后清标记并仅在当前页面状态中显示 key。

## 现有覆盖与缺口

| 目标职责/行为                                                                     | 现有覆盖                                                                                               | 迁移时要求                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL Origin 解析、能力依赖闭包、API path 到字段映射                                | `site-creation-wizard.test.ts` 三组纯 helper 测试                                                      | 随函数迁移，保留既有例子并补齐边界时不改变语义。                                                                                                                                                           |
| 表单交互、Origins 和创建校验/失败                                                 | `site-creation-wizard.ui.test.tsx` 覆盖 Origin 列表、服务端字段错误等                                  | 保持在拆分后的流程/步骤测试中。                                                                                                                                                                            |
| 首次创建和 200 幂等 replay 不暴露原始 key                                         | UI 测试包含 replay metadata-only 断言                                                                  | 保持 201/replay 状态区分及不可恢复文案。                                                                                                                                                                   |
| 替换 key 显式触发、成功后禁用、模糊结果阻止重试并记住 review                      | UI 测试含恢复、成功、ambiguous response/review 场景                                                    | 保留 localStorage 标记、ETag 顺序、明确拒绝和模糊错误分支。                                                                                                                                                |
| 同 payload 重试复用 Idempotency-Key；payload 变化使用新 key；并发双击仅发一个请求 | 实现有 `idempotency` state 和 `createInFlight` ref；现有 UI 测试未专门断言这些边界                     | **缺少保护：** 增加测试，模拟请求超时/网络异常后以相同表单重试，断言 POST body 与 Idempotency-Key 相同；改变 payload 后断言 key 更新；快速重复提交断言仅一次 POST。重点确认 catch/finally 后重试语义稳定。 |
| 恢复身份 query 参数、storage 不可用、替换请求明确 4xx 与 malformed response       | UI 测试覆盖 query 恢复不自动请求和 network ambiguous/review；未覆盖 storage 失败、4xx 或 malformed/5xx | 实现切片前保护 storage 写失败时不发 key 请求、明确 4xx（包括 malformed 4xx body）可复试、成功状态 malformed/5xx 及 network failure 保留 review；policy ETag 顺序也需断言。                                 |

## 验收与验证

实现工作包的验收清单：

- 入口/API contract 不变；职责模块依赖单向、无 server-only client 泄漏到浏览器。
- 所有表单规则、步骤顺序、能力派生、字段错误和用户可见文案保持一致。
- 首次创建、相同 payload 的幂等重试、payload 改动、重复点击、200 replay 均有针对性保护。
- 一次性 key 生命周期、URL 恢复、替换前 policy/ETag、成功/明确拒绝/模糊失败及人工 review 的语义保持。
- 步骤、结果、错误及禁用/等待状态保持语义化标记、键盘操作和现有视觉样式。
- 现有 client/API/UI 覆盖仍运行；新增缺口测试归属于 domain、flow 或 API 职责。

定向检查与回归命令（实施时运行；本工作包不执行）：

- `pnpm --filter @web-analytics/dashboard test -- components/site-creation-wizard`
- `pnpm --filter @web-analytics/dashboard typecheck`
- `pnpm --filter @web-analytics/dashboard lint`
- `pnpm --filter @web-analytics/dashboard test`
- `pnpm e2e:site-onboarding`（真实 onboarding 端到端覆盖；需 Compose、admin 凭据和 Chromium）
- 合并前按改动面运行 `pnpm check`、`pnpm test`，必要时 `pnpm build`。

可分开的提交边界：先迁移纯 domain 并保持测试；再集中 API I/O 与 flow 状态编排并补幂等保护；最后拆步骤/结果视图并运行 UI/E2E 回归。每个边界均可独立审查和回退，期间不改变 route、client 或 API 行为。
