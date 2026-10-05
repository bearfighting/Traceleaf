# M0b 协议静态运行时 Checklist

- 状态：已完成（评估与决策，2026-09-29）
- 上位规划：[Platform Improvement Roadmap](platform-improvement-roadmap.md)
- 设计背景：[Protocol Schema and Static Runtime Models](protocol-static-runtime-design.md)
- 目标：逐步完成 M0b 的评估与决策；在结论明确前不改变生产类型生成或运行时验证行为。

## 范围约定

- M0b 负责评估、试验和决策，不替换生产类型、不改变生产验证行为、不重构 Collector。
- 使用仓库中的真实 contract 和 fixtures，不为迁就生成器而简化 Schema。
- 分开记录 Schema 约束、静态类型表达、运行时校验和语义/业务规则。
- 目标是可重复的脚本和 CI 可检查产物；单靠 AI 或人工编辑不算可复现生成流程。
- 本阶段先在当前 monorepo 评估；只有独立消费者或独立发布确有价值时，才重新评估拆分 protocol repository。

## Checklist

### 1. 确定评估样本

- [x] 选择一个有版本的事件 contract 和一个配置 contract，并记录选择理由。
- [x] 记录 Schema 入口、`$ref` 依赖、现有 TS/Rust 类型、运行时消费者及 valid/invalid fixtures。
- [x] 用现有工具记录这些 fixtures 当前通过 Schema 和服务校验的结果，作为基线。
- [x] 检查 fixtures 是否覆盖必填/可选、union/discriminator、未知字段、动态 JSON、格式、范围及适用的跨字段约束。

**证据 / 备注**

- 事件样本：Event Batch V1，含三类事件与 Browser Context；见 [逐例基线](m0b-step1-sample-baseline.md)。
- 配置样本：Stored Environment Policy V1；见 [逐例基线](m0b-step1-sample-baseline.md)。
- 基线命令：`node scripts/check-contract-fixture-schema-baseline.mjs`、`pnpm protocol:validate`、`cargo test -p collector canonical_ -- --nocapture`、`cargo test -p collector runtime_policy::tests -- --nocapture`、`cargo test -p collector canonical_policy_fixtures_match_runtime_parser -- --nocapture`；结果与限制见逐例基线。
- Fixture 覆盖缺口：未知字段、日期/标识符格式、边界值、更多动态 JSON 限制和 Web Vital 时间关系；详见逐例基线覆盖表。

### 2. 验证生成流程是否可脚本化

- [x] 记录候选生成器（包括 Schema Transformation Toolkit）的仓库地址、不可变 commit/release、运行时/工具链版本和许可证。
- [x] 记录精确命令、配置、输入、输出路径及所有预处理/后处理。
- [x] 从干净状态重复生成，格式化后逐字节比较输出。
- [x] 验证不支持的 Schema 特性会明确失败；不得静默丢约束、改 Schema 或把人工修补伪装成生成结果。
- [x] 验证一个命令可以重新生成，并有 check 模式发现已提交产物过期。
- [x] 记录是否依赖 AI/人工介入，以及这些步骤能否转成确定性的脚本或配置。

**证据 / 备注**

- 候选及固定版本：Toolkit commit `825f4398e125f586354a18ba575d4d37edc5c745`、json-schema-to-typescript `16.0.0`、cargo-typify `0.8.0`；锁定方式、许可与工具链见[第二步结果报告](m0b-step2-generator-feasibility.md)。
- 生成 / 检查命令：[试验脚本](../../../scripts/compare-contract-type-generators.mjs) 的 `--snapshot` / `--check`；精确命令、原始失败和输入处理见第二步结果报告。
- 可重复性结果：两个干净目录的结果清单和四份成功产物逐字节一致；`--check` 正常通过，故意改动临时样本时退出 1；`pnpm protocol:validate` 退出 0。
- 人工介入或不支持特性：无生成后人工修补。事件 Rust 因外部 `$ref`、保留约束后的 `if/then/else` 未生成；Toolkit 配置 TS 有损，typify 配置 Rust 的 `schema_version` 类型变宽。四条路径的限定结论见第二步结果报告；Toolkit 的详细问题见[专项报告](m0b-toolkit-findings.md)。

### 3. 评估生成类型质量

- [ ] TypeScript 产物可编译，并可通过现有 `packages/protocol-ts` 入口使用。
- [ ] Rust 产物可编译，并能按预期 Serde 行为反序列化真实 wire JSON。
- [ ] 必填/可选/nullability、常量/枚举、事件 union、`$ref` 和动态 JSON 表达符合预期。
- [ ] 未知字段行为符合 contract：允许的字段可接受或保留，禁止的字段会拒绝。
- [ ] 生成文件有清晰标识，无未记录的生成后手工编辑。
- [ ] 分别记录 TS/Rust 的类型变宽、语义损失、API 可用性、命名问题和适配成本。

**证据 / 备注**

- TypeScript：三份生成 TS 均经严格隔离编译；json2ts 表达 discriminator 和 batch 非空数组，但未表达 Page View context 成对约束及字符串/数值约束；Toolkit 配置类型的 camelCase wire 键不兼容。现有 package typecheck 通过；详细对照见[第三步报告](m0b-step3-generated-type-quality.md)。
- Rust / Serde：typify 配置样本在临时 crate 编译成功。两份有效 policy fixtures 通过；8 份现有无效 fixtures 中，除空 origins 被错误接受外均拒绝。探针还显示 schema_version=2、空/重复 origins 被接受，u64 范围外正整数被拒绝；报告附完整结果矩阵。
- 已知损失或适配：需 runtime Schema validator 承担仍未编码的约束；Toolkit TS 不能直接表示 wire snake_case 对象。事件 Rust 无生成产物。本步未接入生产类型或 package export。

### 4. 盘点静态类型无法保证的约束

- [x] 分类列出 Schema 约束：格式/正则、长度、数值边界、集合大小、额外字段策略、条件/跨字段约束和版本规则。
- [x] 列出 Schema 外语义/安全规则，包括 Custom Event properties 深度/大小/键/隐私规则，以及 Web Vital rating/时间关系。
- [x] 每条规则记录权威来源、静态类型是否表达、运行时执行责任方和 parity 测试。
- [x] 明确生成类型不等于对不可信 JSON 做运行时验证。

**证据 / 备注**

- 逐规则矩阵：[第四步约束与运行时责任清单](m0b-step4-constraint-inventory.md)，分别映射两个样本的 Schema 字段、当前/候选类型、Collector 运行时所有者、现有 fixtures/tests 和第六步缺口。
- 需要显式运行时校验的规则：TS/Rust 基础类型不能充分承担格式、长度、数值/集合边界和条件约束；Custom Event properties 的隐私/复杂度限制、Web Vital 评分与事件时间关系、batch 单站点、policy 数据库行身份及跨策略 Origin 冲突是额外语义责任。清单区分这些规则与 Schema 判定。
- 验证证据：`pnpm protocol:validate`、`cargo test -p collector canonical_ -- --nocapture`、`cargo test -p collector runtime_policy::tests -- --nocapture` 均通过；Collector policy Schema 对 `date-time` 未显式启用 format assertion，且无 invalid date-time fixture，因此清单将实际格式判定列为未证实，而未推断为已覆盖。
- 未决责任边界 / 后续工作：生成类型不得作为不可信 JSON 的验证器；第六步补齐或独立定义清单标出的 parity fixtures，并把跨文档、时钟和隐私语义与纯 Schema 判定分开。管理 API contract 与 HTTP 鉴权不在本样本矩阵范围。

### 5. 明确运行时验证架构

- [x] 记录 Collector 当前流程：事件 Schema 在启动时编译、注入应用状态；policy Schema 当前在每次 refresh 时编译，之后执行文档验证、反序列化和语义校验。
- [x] 明确过渡目标：各契约 validator 在进程启动时构造，由启动层注入各自消费者；Handler 和 refresh 循环不加载、解析或编译 Schema。
- [x] 决定按契约拆分具体验证组件；目前不引入 trait/interface，除非出现实际替代实现需求。
- [x] 区分结构校验与语义/安全校验，并保持当前稳定的外部错误行为；内部诊断不成为 API contract。
- [x] 决定 parity 通过后再评估静态运行时校验；Schema 与 fixtures 保留在 CI。
- [x] M0b 本项只记录决策，不重构生产代码；validator 生命周期调整作为后续实施任务。

**证据 / 备注**

- 当前实现：`services/collector/src/main.rs` 创建事件 `Validator` 并传给 `http::router_with_capabilities`；`services/collector/src/http.rs` 将其放入共享 `AppState`，事件请求通过 validator 后执行时间范围等 HTTP 语义校验。`services/collector/src/runtime_policy.rs::refresh_once` 每轮重建 policy validator，`parse_database_policy` 执行 Schema、Serde、数据库行身份/版本和 digest 校验。
- 目标结构与错误语义：见[协议静态运行时设计](protocol-static-runtime-design.md)及 [ADR-015](../../decisions/ADR-015-validation-lifecycle-and-staged-static-migration.md)。事件与 policy 使用分开的具体验证组件，由启动层构造并注入；事件无效仍返回 `invalid_event_batch`，无效 policy 保留 last-good 并标记 stale。
- 后续阶段：一次性构造并复用 policy validator 属于后续低风险实现任务；第六项完成 parity 并解释所有差异后，再决定是否推进生产静态校验。ADR-015 仅涵盖本次 M0b 样本与 Collector 直接消费者，不替其他配置/API contract 作决定。

### 6. 验证跨语言 parity

- [x] 选定 valid/invalid fixtures 通过纯 JSON Schema 判定和隔离 TS 静态校验原型。
- [x] 同一组 fixtures 通过隔离 Rust 静态校验原型；policy 同时记录 typify 原始 Serde 和附加约束后的结果。
- [x] 比较 Schema、TS、Rust、Collector 当前结果，解释所有接受/拒绝差异；低层错误文本不作为 parity 标准。
- [x] 对缺失边界和跨字段案例补充 canonical fixtures；数据库行身份和跨策略 Origin 继续使用独立语义测试，不伪装成单文档 fixture。
- [x] 对 TS JSON round-trip 及 Rust Serde 输出执行 Schema 反向校验，并记录序列化差异。

**证据 / 备注**

- 可重跑命令：`node experiments/m0b/parity/run.mjs`；脚本编译并运行隔离 TS/Rust 原型，读取 Collector policy 定向测试结果，生成忽略目录中的 JSON/TSV 结果和 tracked [逐 fixture 矩阵](m0b-step6-parity-matrix.tsv)。详细结论见[第六步报告](m0b-step6-parity-report.md)。
- Fixture 覆盖：事件 12 valid / 27 invalid；stored policy 2 valid / 15 invalid，共 56 例。新增 batch 恰好 100 项、Context 边界/未知字段、Custom properties 复杂度限制、Web Vital 时间关系、policy date-time/版本/重复 Origin/未知字段等案例。
- 判定结果：TS 静态原型与 Rust 静态原型（typify policy + 显式规则）对 56 例均符合目录预期；Collector 事件 validator 与预期一致。纯 Schema 接受 9 个应由语义规则拒绝的事件；Collector policy parser 接受 2 个 Schema 判为无效的 date-time 文档。原始 typify Serde 另接受空/重复 origins 与 schema_version=2 三个无效样本，隔离显式检查已补足这些规则。
- 序列化：Rust Serde 反序列化后再序列化的事件样本中，10/12 个有效 fixture 输出不能通过 Schema，原因是缺失的 `Option` 字段被输出为 `null`；policy 的两个有效样本可通过。TS 只有 JSON 对象 round-trip，没有单独的运行时模型 serializer，不能据此声称生成 TS 类型具备序列化行为。
- 跨文档语义：Collector 数据库行身份/版本不匹配由 `rejects_database_identity_and_version_mismatches` 覆盖（已补 version 正反例）；跨 environment Origin 冲突由 canonical `policy-semantic-cases.json` 与 `pnpm protocol:validate` 覆盖。
- 验证命令：`pnpm protocol:validate`、`pnpm --filter @web-analytics/protocol-ts test`、`pnpm --filter @web-analytics/protocol-ts typecheck`、`cargo test -p collector canonical_ -- --nocapture`、`cargo test -p collector runtime_policy::tests -- --nocapture` 均通过。Collector policy 的两个 date-time 接受结果作为已知生产差异被定向测试明确断言；未改生产验证行为。

### 7. 按 contract 类别做决策

- [x] 分别为事件和配置样本决定生成并提交、手工维护并做 parity，或其他有依据的方案。
- [x] 决定被测 Toolkit 用于生产生成、仅用于评估，还是否决。
- [x] 明确本 monorepo 内产物位置和消费者入口；没有明确跨仓库发布需求时不拆 repository。
- [x] 为每个样本决定未知字段与协议版本兼容策略。
- [x] 明确 CI 门禁：生成检查、fixture parity、编译或组合方案。
- [x] 在 ADR 中记录结论、证据和备选方案。

**决策记录**

- 事件 contract：TypeScript 使用固定版本的 `json-schema-to-typescript` 生成并提交；Rust wire 类型继续手工维护并通过共享 canonical fixtures 做 parity。后续 Rust 类型须保留 Schema 允许的 Page View 扩展字段，并确保省略的可选字段序列化时不产生 Schema 禁止的 `null`。
- 配置 contract：TypeScript 使用固定版本的 `json-schema-to-typescript` 生成并提交；Rust 使用固定版本的 `typify` 生成结构类型，并在类型解析之后用显式规则补足 `schema_version`、非空 `origins`、唯一性等生成产物未保证的约束。生成类型不承担不可信 JSON 的完整运行时验证。
- Toolkit：当前受测 commit / SDK 0.7.0 不接入生产；Toolkit 保留为长期优先改进候选，目标是满足[专项报告定义的项目能力与验收要求](m0b-toolkit-findings.md)后，重新评估为主要生成工具。
- 产物位置 / 消费者：继续在 monorepo 内维护，不拆 protocol repository。TypeScript 生成文件放入 `packages/protocol-ts/src/generated/`，由现有 package 根入口导出事件与配置类型。Rust 事件手工 wire 类型由 Collector 现有 `services/collector/src/protocol.rs` 提供；配置生成类型放入 Collector 的专用 generated 模块，并由 policy runtime 的模块入口使用。此布局是后续接入目标，本步不新增文件或改消费者。
- 未知字段 / 版本：严格遵循各 Schema 的规则。Stored Environment Policy V1 拒绝未声明字段及非 V1 `schema_version`。事件对象仅在 Schema 允许时接受扩展；Page View Rust 类型须保留允许的扩展字段。事件 V1 的版本/判别字段按 Schema 常量处理，不接受其他版本。
- CI 门禁：后续接入时固定生成器版本并提交 lock 信息；生成 `--check` 发现产物漂移，TypeScript package typecheck/test 与 Collector Rust compile/test 检查消费兼容性，`node experiments/m0b/parity/run.mjs` 检查两语言与 Schema/Collector 的 fixture parity。Schema fixtures 继续由 `pnpm protocol:validate` 检查。M0b 第七步只定义门禁，不接入 CI workflow 或构建脚本。
- 证据 / 决策文档：第二步生成流程报告、第三步质量报告、第六步 parity 报告与逐例矩阵；决策及备选方案见 [ADR-016](../../decisions/ADR-016-contract-type-sources-and-generation.md)。

### 8. 完成 M0b 并拆出实施任务

- [x] 总结结果、剩余风险和 M0b 明确未修改的内容，见 [M0b 收尾摘要](m0b-final-summary.md)。
- [x] 按结论把共用生成检查与 policy 工作纳入 M2，把事件类型迁移纳入 M9；不在 M0b 中实施生产改动。
- [x] 更新 [roadmap](platform-improvement-roadmap.md) 与本 checklist 状态，并链接报告和 ADR-015/016。

**退出条件**

- [x] 已证明选定路径可重复，并否决不适合生产的 Toolkit 路径；替代方案有生成检查与 fixture parity 门禁。
- [x] 基于真实样本记录 TS/Rust 类型质量、不支持路径及有损行为。
- [x] 明确运行时验证责任和依赖注入边界，见 ADR-015。
- [x] 记录 56 个共享 fixtures 的 parity 结果，并将已知差异分派到 M2/M9 后续处理。
- [x] 决策进入 ADR-016；M0b 评估期间未改生产类型、运行时校验或构建流程。

**最终证据**

- 总结：[M0b 收尾摘要](m0b-final-summary.md)；生成策略：[ADR-016](../../decisions/ADR-016-contract-type-sources-and-generation.md)；运行时边界：[ADR-015](../../decisions/ADR-015-validation-lifecycle-and-staged-static-migration.md)。
- 逐阶段记录：[样本基线](m0b-step1-sample-baseline.md)、[生成可行性](m0b-step2-generator-feasibility.md)、[类型质量](m0b-step3-generated-type-quality.md)、[约束责任清单](m0b-step4-constraint-inventory.md)、[parity 报告](m0b-step6-parity-report.md)和[逐 fixture 矩阵](m0b-step6-parity-matrix.tsv)。
- 后续实施归属：配置类型、policy validator 生命周期和 date-time 差异进入 M2；事件 Rust wire 行为和静态迁移进入 M9。生产切换前继续保留当前校验行为。
