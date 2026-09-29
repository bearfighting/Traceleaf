# Protocol Schema 与运行时静态模型设计

- Status: Proposed
- Scope: Event protocol schemas, configuration contracts, capability manifest, runtime validation
- Overall sequence and gates: [Platform Improvement Roadmap](platform-improvement-roadmap.md)
- Related: [Site Onboarding and Settings Design](site-onboarding-settings-design.md), [Capability-oriented configuration (ADR-007)](decisions/ADR-007-capability-oriented-configuration.md)

## 背景

`protocol/` 保存跨语言的 JSON Schema、fixtures 和 capability manifest。Schema 是描述消息结构与约束的语言无关契约；服务需要遵守契约，但不应在生产运行时持续解析或解释 Schema 来决定业务行为。

当前服务将部分 Schema 通过 `include_str!` 嵌入二进制，并在运行时建立 JSON Schema validator。部分路径存在重复编译：Collector environment policy 每轮配置刷新都会建立 validator；configuration runtime 一方面缓存 validator，另一方面在文档转换函数内重新编译；Analytics API 也会在管理请求处理时编译 Schema。

本设计采用分阶段路径：在跨语言 parity 尚未完成前，运行时继续使用 Schema validator；每个契约的 validator 应在进程启动时构造并注入消费者，避免 Handler 或刷新循环重复加载/编译。parity 结果经评审后，再决定是否把生产运行时切换为静态解析和显式校验；Schema 继续作为协议契约及开发期/CI fixtures 验证依据。Collector 事件与存储策略样本的决策见 [ADR-015](decisions/ADR-015-validation-lifecycle-and-staged-static-migration.md)。

## 设计原则

1. **契约与执行逻辑分离**：Schema 描述数据形状和公开约束；服务代码负责类型解析、业务不变量和错误语义。
2. **运行时仍需验证输入**：静态类型不覆盖所有 JSON Schema 约束。当前过渡阶段由运行时 Schema validator 与显式语义校验共同验证输入；若 parity 后决定静态化，所有外部 JSON 和数据库配置仍需由静态解析和显式规则在运行时验证。
3. **协议变化显式进入代码**：Schema 变更必须同步更新受影响语言的静态模型、校验逻辑和测试；Schema 文件自身不能静默改变线上行为。
4. **分层看待不同契约**：事件协议、配置 API、持久化配置文档、capability manifest 的消费者和兼容要求不同，不使用一种统一机制处理。
5. **版本兼容明确**：事件类型按协议版本建模；服务决定明确支持哪些版本，以及字段变化何时需要升级版本。
6. **以正负 fixtures 防漂移**：同一组 valid/invalid fixtures 同时检查 JSON Schema 和运行时代码的接受/拒绝结果。

## 与总规划的关系

配置存储类型和管理 API 类型应在 Site Management 所拥有的数据/API contract 冻结后实现，并分别放在 owner module；Collector、Processor 和 Analytics 共用的最小能力快照继续由 `crates/configuration-runtime` 承载。该 crate 不暴露完整管理文档或管理写操作。M0a 已建立事件/配置 Schema 消费与测试现状基线；M0b 再用一个事件 contract 和一个配置 contract 评估类型生成器，决定按 contract 类别采用生成或手工类型、未知字段策略及 CI parity 门禁；M2/M9 实现时遵守该决定。重复 Schema validator 编译可先独立修复；Collector 事件协议静态化是一条独立技术线，不阻塞 Site Registry 和 onboarding。具体合并门槛以 [Platform Improvement Roadmap](platform-improvement-roadmap.md) 为准。

## 当前依赖清单

| 区域                          | 当前做法                                                                                                                     | 主要问题                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Collector 事件输入            | `validation.rs` 将 event batch、事件和 context JSON Schema 嵌入二进制，进程启动时编译 validator，输入请求由该 validator 校验 | 线上输入校验直接由 Schema 执行；Collector 另有 Rust event structs，但类型与 validator 之间的职责边界不清晰 |
| Collector environment policy  | `runtime_policy.rs` 每次刷新数据库策略时解析并编译 policy Schema，再解析为 `StoredPolicy`                                    | 每轮刷新重复编译；Schema validator 和静态结构体重复表达约束                                                |
| Capability runtime            | `configuration-runtime` 缓存 capability Schema validator，但 `CapabilitySnapshot::from_document` 还会独立解析和编译 Schema   | 重复验证/编译，且快照模型与 Schema 双重绑定                                                                |
| Analytics API 管理请求        | `configuration.rs` 用 `serde` 部分解析请求，另用 JSON Schema validator 校验 update 文档                                      | API 处理路径依赖 Schema 运行时构建；部分结构仍使用 `serde_json::Value`                                     |
| Processor capability registry | `capabilities.rs` 运行时反序列化 manifest 并用 Schema 检查；ID enum/count/dependencies 同时有静态定义                        | `capabilities.json` 是有运行语义的 manifest，不是单纯 Schema；权威来源和生成边界不明确                     |
| TypeScript protocol types     | `packages/protocol-ts` 已有事件与 context 静态类型                                                                           | 需要持续验证类型、Schema 和 fixtures 的一致性                                                              |
| CI/开发期校验                 | scripts 使用 Ajv 检查 Schema、manifest 和 fixtures                                                                           | 这是适合保留的 Schema 使用场景                                                                             |

M0b 选定的 Collector 事件与 Stored Environment Policy 样本，当前事件 validator 已在启动期创建并注入 HTTP 应用状态；policy validator 仍在每轮数据库 refresh 中创建。过渡目标是按契约分别构造并注入具体验证组件，先消除重复构造，再以 parity 结果决定是否静态化。其他服务与 contract 的 validator 生命周期由各自实施阶段确定。

## 目标模型

### JSON Schema 的职责

Schema 保留在 Protocol 中，用于：

- 描述版本化的 wire format 和配置 contract。
- 校验 canonical valid/invalid fixtures。
- 在 CI 中检查协议文件结构、`$ref`、示例和 OpenAPI 一致性。
- 作为语言类型生成的输入（若选用代码生成）。

静态化被选定并完成迁移的 contract 不应在 production service 中 `include_str!`、读取或建立 JSON Schema validator。在迁移决策完成前，运行时 Schema validator 仍可作为过渡校验路径，但必须由启动层构造并注入，不得在请求/刷新热路径编译。Schema validator 是否退出生产依赖，由对应 contract 的 parity 证据和阶段决策确定。

### 静态类型和运行时校验

各语言的静态模型在构建前准备完成并随代码版本部署。运行时流程为：

```text
untrusted JSON / database JSONB
  → deserialize into versioned static type
  → explicit structural and semantic validation
  → domain/service model
```

例如，Collector 输入解析到 `EventBatchV1`；数据库策略解析到 `StoredPolicyV1`；管理 API 请求解析到对应的 update request 类型。

静态类型负责表示字段、枚举和版本。显式校验函数继续负责 Schema 之外或未能通过类型表达的约束，例如：

- 字符串长度、数值范围和跨字段约束。
- Site/environment/version 与存储主键的一致性。
- capability 依赖和必选 capability。
- Origin 规范化、唯一性和安全策略。
- custom event properties 的深度、大小和敏感字段规则。
- Ingest Key digest 和 key ID 格式。

反序列化错误和业务校验错误应映射为稳定的 API/Collector 错误类别，不将内部路径或实现细节泄露给客户端。

### 类型来源策略

存在两种合理路径。M0b 必须对代表性的事件和配置 Schema 分别进行一次小范围生成试验，检查 union、`$ref`、额外字段和动态 JSON 字段的输出质量，然后按 contract 类别选定路径并记录版本固定的工具、生成命令或手工 parity 规则：

1. **生成并提交类型（推荐优先评估）**：从 Schema 生成 Rust/TypeScript 模型，生成结果受版本控制；CI 运行 generator 并检查无 diff。Schema 生成器无法表达的语义规则仍写在服务代码中。
2. **手工维护类型**：适用于生成结果不清晰、动态数据占比较高的部分；必须用 Schema fixtures 和一致性测试防止漂移。

不论采用哪种方式，都不生成或执行 production runtime JSON Schema validator。不能因为生成器将某字段映射为通用 JSON value，就误以为该字段无需显式运行时约束。

### M0b 候选工具：Schema Transformation Toolkit

M0b 对 SDK 0.7.0 的评估结果、项目所需的 JSON Schema → TypeScript/Rust 能力、验收条件与后续实现优先级已转移到独立 Toolkit 仓库维护：详见 `../../schema-transformation/schema-transformation-toolkit/docs/development/design.md` 的 downstream acceptance profile、`../../schema-transformation/schema-transformation-toolkit/docs/development/progress.md` 的 WAP integration priority，以及 `../../schema-transformation/schema-transformation-toolkit/examples/web-analytics-platform-m0b/` 的完整样例包。

本仓库保留 M0b 的总体生成策略、Schema/Collector parity 与生产运行时决策。当前受测 Toolkit release 不接入生产；待 Toolkit 达到其下游能力门槛并通过原始 schemas 与共享 fixtures 后，再重新评估为主要转换工具。

## 契约分类和处理策略

### 事件协议

- 按 schema version 建模，例如 `EventBatchV1`，避免一组可变类型模糊代表多个 wire version。
- 用带事件类型判别的静态枚举/union解析 Page View、Custom Event、Web Vital。
- 明确保留或拒绝未知字段的策略。若 Schema 禁止额外字段，Rust serde 与 TypeScript runtime validation 应同样拒绝；若允许向前兼容字段，也要有明确规则。
- `context` 和 `properties` 可继续保留动态 JSON value，但必须保留各自的 schema-aware 或代码级安全验证。
- 新协议版本增加对应类型和 validator adapter；服务按显式的版本分派处理，禁止把新版本静默按旧类型解析。

### 管理 API 与配置文档

- HTTP request 解析为静态 request types，再调用语义校验函数。
- 数据库 JSONB 文档解析为 versioned stored types，并验证数据库行标识、版本号和时间戳一致性。
- 数据库 CHECK constraints 继续作为持久化边界的一层防线，但不代替服务读取文档时的运行时检查。
- 未识别的配置 schema version 按清晰的 stale/unsupported 状态处理，不能静默丢弃字段或降级为默认值。

### Capability manifest

`capabilities.json` 是描述能力 ID、依赖和实现/数据面的 manifest，不是 JSON Schema。应独立确定权威策略：

- 若同一服务版本中的能力依赖是静态业务规则，把 manifest 生成成静态 registry，或由静态代码定义行为，并在 CI 校验 registry 与 manifest 一致。
- 若确实需要不同部署在不更新二进制时改变能力定义，才将它视为版本化运行时数据；需另行设计兼容、缓存、签名/来源和回滚语义。

当前 manifest 是编译时嵌入的仓库文件，并非独立远程运行时配置；因此推荐静态 registry/生成代码，并消除 ID、数量和依赖关系的重复手工列表。

## 渐进迁移阶段

### Phase 0：基线和契约盘点（M0a + M0b）

- 建立 schema → runtime consumer → type/model → fixtures 的映射表。
- 整理现有 valid/invalid fixtures，记录服务当前接受/拒绝行为及错误码。
- M0a：建立 Schema → runtime consumer → type/model → fixtures 映射，记录当前协议版本、Schema 消费者、接受/拒绝行为和错误码。
- M0b：完成事件与配置各一个静态类型生成样本；将 Schema Transformation Toolkit 作为候选之一，固定版本并实测其真实 JSON Schema 到 TypeScript/Rust 的支持边界、生成质量、Serde/wire 适配和 fixtures parity。决定该工具按 contract 类别采用、仅用于评估或不采用；同时决定哪些 contract 生成并提交类型、哪些手工维护，明确未知字段策略、版本兼容规则，以及 CI 的生成无差异检查或 fixtures parity 门禁。
- 不改变 production 行为。

### Phase 1：启动期构造并注入 Schema validator（过渡阶段）

在 parity 评估完成前保留当前 Schema 判定行为，先统一 validator 生命周期：

- Collector 事件 validator 保持在服务启动时构建，并注入 HTTP 应用状态。
- Collector `RuntimePolicyManager` 的 policy validator 改为启动时构建并注入/持有，不在每次配置刷新时重编译。
- configuration runtime 统一使用已缓存的 validator，移除 `from_document` 内部的重复编译。
- Analytics API 将 update schema validator 在应用初始化时构建并共享，而非每个请求重建。

Collector 事件与 policy 使用分开的具体验证组件；当前没有多实现需求，不预先增加 trait/interface。该生命周期调整只保留现有规则，不代表最终选择运行时 Schema 引擎。

### Phase 2：parity 决策门

- 对每个 contract 比较 JSON Schema 与拟议静态解析/显式校验的 valid/invalid 接受结果，解释并处置全部差异。
- 只有 parity 结果可审查且错误/未知字段兼容要求清晰后，才决定该 contract 是否切换静态运行时验证。
- 未通过 parity 的 contract 继续使用已在启动时构造并注入的 Schema validator，不以类型生成成功替代运行时校验。

### Phase 3：数据库配置静态化

- 在 Site Management 的存储 contract 和旧站点迁移规则冻结后，从 `StoredPolicy`、`StoredKey`、`StoredCapability` 等已有结构开始；新增 Site Registry 类型按实际 migration/API 同步加入。
- 增加显式字段级和跨字段校验，覆盖当前 Schema 与数据库约束的关键规则。
- 在同一测试中对有效/无效 fixture 同时运行 Schema validator 和静态解析器。
- 先双跑比对结果，再切换运行路径；稳定后移除对应 runtime Schema validator。

### Phase 4：管理 API request 静态化

- 将 capability update、environment policy update、definition update 和相关响应改为具体请求模型；Site create/list/detail 类型随已冻结的新增 API contract 加入。
- 把 `serde_json::Value` 限制在真实动态字段内，不用于包裹整个已知 contract。
- 保留 optimistic concurrency、ETag、审计和稳定 API error semantics。
- 对新增、未知字段、无效依赖和越界值建立正负 contract tests。

### Phase 5：Capability registry 静态化（总规划 M2）

- 决定 manifest 哪些字段是产品文档元数据，哪些字段影响运行行为。
- 将 ID、依赖、支持状态等静态信息生成到 Rust/TypeScript registry，或收敛到一个明确的静态来源。
- CI 对比生成 registry 与 manifest，防止 ID、count、dependencies 漂移。
- 删除不必要的运行时 manifest JSON Schema 校验。此阶段在 Site onboarding 使用 capability 默认值和依赖之前完成。

### Phase 6：事件 Collector 静态化（总规划 M9，独立技术线）

- 从现有 Collector Rust types 和 `packages/protocol-ts` 开始整理版本化 event types。
- 用静态类型解析 batch/event；补足当前结构体尚未覆盖的 unknown-field、format、range 和跨字段规则。
- 用共享正负 fixtures 验证静态实现与 JSON Schema 的接受/拒绝一致。
- 保留批次单 Site、隐私、事件大小、custom property 规则和现有 HTTP 状态/错误语义。
- 切换稳定后从运行依赖中移除 `jsonschema`；仍被测试/contract validator 使用时保留为 dev dependency。
- 此技术线在 M0a 事件 contract/fixtures 现状基线完成、且 M0b 类型策略确定后可独立推进，不以配置静态化结束为前置条件。

### Phase 7：收敛和移除旧路径

- 删除 production runtime 的 JSON Schema load/compile 代码及不再需要的依赖。
- `protocol:validate` 保留 JSON Schema、fixtures、OpenAPI 和生成结果检查。
- 更新开发规则：协议变更需同步 Schema、generated/static types、semantic validation、fixtures 和版本策略。
- 对比运行前后启动时间、刷新行为、Collector 请求处理结果和错误语义。

## CI 与测试要求

- 所有 canonical fixtures 继续由 JSON Schema 在 CI 中验证。
- 同一组 fixtures 由各语言静态解析器和语义校验器执行，比较接受/拒绝结果。
- 覆盖协议版本分派、未知字段策略、缺失字段、类型错误、范围错误、依赖错误和边界值。
- 对采用生成代码的 contract 运行 `generate --check`，确保提交的生成文件与 Schema 一致；手工类型使用正负 fixtures parity 和语义校验覆盖对应规则。
- 对序列化输出执行 schema validation，防止服务产生契约外的响应/事件。
- 运行完整 collector / config API tests 和现有 E2E，确认 HTTP 状态、事件入库、配置刷新和兼容行为未变。
- CI 应确保 production targets 不依赖 JSON Schema runtime crate，若 workspace 其他模块仍需要该 crate，按 crate/target 级别核查而不是仓库全局移除。

## 风险和兼容性

- **静态模型不等价于完整 Schema**：日期格式、pattern、oneOf、min/max、跨字段条件需要显式补充和测试。
- **未知字段策略影响兼容**：严格拒绝可以避免静默漂移，但可能使旧服务拒绝新客户端的 additive fields；必须由协议版本政策决定，不能无意中改变。
- **类型生成可能丢失语义**：复杂 `$ref`、union 或自由 JSON 字段可能生成宽泛类型；需要人工校验生成结果及运行时语义验证。
- **错误语义可能改变**：将 validator 替换成 serde 后的错误细节不同；对外 API 应保持稳定错误类别，不承诺内部 JSON path 完全相同，除非已是公开 contract。
- **双重定义漂移**：手工维护 types/validators 会重复描述约束；以 fixtures parity tests 和生成检查作为强制门禁。
- **Protocol 变更仍需协调发布**：从运行时 Schema 切换为静态模型后，Schema 修改需要相关服务重新构建/发布，这是预期的显式耦合边界。

## 验收标准

- Production 服务不再解析或编译 JSON Schema 来处理事件、配置或数据库文档。
- 所有外部输入和从 JSONB 加载的文档仍有等价或更严格的静态解析与业务校验。
- JSON Schema 继续在 CI 中验证 fixtures 和生成类型一致性。
- Schema 与 Rust/TypeScript 静态模型变更不同步时，CI 失败。
- Capability manifest 的运行时语义来源明确，不再有 ID/count/dependency 多处无校验复制。
- 事件和配置版本支持策略、未知字段行为和错误语义均有文档及测试。
- Collector policy refresh 不重复编译 validator；替换后无每轮 refresh 的 Schema 编译。
- 所有现有事件、配置、隐私、安全和 E2E 行为保持兼容，或由明确的协议版本/迁移说明覆盖。
