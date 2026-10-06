# Dashboard 创建站点重构试点设计

本设计对应[代码重构 Checklist 1.4](./code-refactoring-checklist.md)，选择 Dashboard 创建站点向导作为首个多文件重构试点。工作包 1.4 只确认范围和目标边界，不搬移生产实现。

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

| 目标职责/行为                                                                     | 现有覆盖                                                                           | 迁移时要求                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL Origin 解析、能力依赖闭包、API path 到字段映射                                | `site-creation-wizard.test.ts` 三组纯 helper 测试                                  | 随函数迁移，保留既有例子并补齐边界时不改变语义。                                                                                                                                                           |
| 表单交互、Origins 和创建校验/失败                                                 | `site-creation-wizard.ui.test.tsx` 覆盖 Origin 列表、服务端字段错误等              | 保持在拆分后的流程/步骤测试中。                                                                                                                                                                            |
| 首次创建和 200 幂等 replay 不暴露原始 key                                         | UI 测试包含 replay metadata-only 断言                                              | 保持 201/replay 状态区分及不可恢复文案。                                                                                                                                                                   |
| 替换 key 显式触发、成功后禁用、模糊结果阻止重试并记住 review                      | UI 测试含恢复、成功、ambiguous response/review 场景                                | 保留 localStorage 标记、ETag 顺序、明确拒绝和模糊错误分支。                                                                                                                                                |
| 同 payload 重试复用 Idempotency-Key；payload 变化使用新 key；并发双击仅发一个请求 | 实现有 `idempotency` state 和 `createInFlight` ref；现有 UI 测试未专门断言这些边界 | **缺少保护：** 增加测试，模拟请求超时/网络异常后以相同表单重试，断言 POST body 与 Idempotency-Key 相同；改变 payload 后断言 key 更新；快速重复提交断言仅一次 POST。重点确认 catch/finally 后重试语义稳定。 |
| 恢复身份 query 参数、storage 不可用、替换请求明确 4xx 与 malformed response       | 现有 UI 测试覆盖部分恢复和模糊结果；其余路径未见明确断言                           | 实现切片前依据当前测试逐项核对，至少保护存储失败时不发 key 请求、明确 4xx 可复试、malformed/5xx 仍需 review。                                                                                              |

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
