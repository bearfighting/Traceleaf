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

- [ ] 依据各自状态所有权确定一个或多个完整切片，不先做横向通用框架。
- [ ] 将展示、API/I/O、格式转换和领域校验分别放到已确认的边界。
- [ ] 保持编辑、保存、失败反馈、空状态和兼容语义。
- [ ] 按切片运行 Dashboard 检查和回归测试。

### 工作包 4：Rust configuration runtime 和服务边界

- [ ] 先整理 configuration-runtime 的模块入口和类型职责。
- [ ] 按 HTTP 请求边界重构 Collector handler 调用链。
- [ ] 按校验/应用服务/持久化边界整理 site configuration 流程。
- [ ] 保持公共 API、错误语义、策略、安全限制和数据库行为。
- [ ] 运行对应 crate/service 的 fmt、clippy、tests 和 build。

### 工作包 5：Rust Processor 流水线

- [ ] 根据基线流程图按领域处理阶段拆分实现与紧密相关类型。
- [ ] 将大型测试按行为场景组织，保留明确 fixture/helper。
- [ ] 保持处理顺序、幂等/rebuild/backfill 语义及事务边界。
- [ ] 运行 processor 定向测试和 workspace Rust 检查。

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
