# M0b 收尾摘要：类型生成与 Schema parity 评估

- 状态：评估与决策已完成（2026-09-29）
- 范围：Event Batch V1（含三类事件与 Browser Context）和 Stored Environment Policy V1
- 决策依据：[ADR-015](decisions/ADR-015-validation-lifecycle-and-staged-static-migration.md)、[ADR-016](decisions/ADR-016-contract-type-sources-and-generation.md)

## 结论

- 固定版本评估证明 json-schema-to-typescript 与 typify 的试验路径可重复；受测 Toolkit commit / SDK 0.7.0 当前不接入生产。Toolkit 仍是长期优先改进候选，目标能力与重新采用门槛见[专项报告](m0b-toolkit-findings.md)。
- 事件 TypeScript 和 policy TypeScript 采用 json-schema-to-typescript；policy Rust 采用 typify 结构类型并补显式约束；事件 Rust 继续手工维护并做共享 fixture parity。
- 类型定义不替代运行时校验。Schema 与 canonical fixtures 继续进入 CI；未来生成接入须提供固定工具版本、生成检查、语言编译检查及共享 fixture parity。
- 保持 monorepo，不新建 protocol repository。具体类型来源、产物位置和消费者入口见 ADR-016。

## Parity 结果

第六步对 56 个 canonical fixtures（事件 39、policy 17）执行了 Schema、隔离 TS/Rust 静态原型及 Collector 当前路径对照：

- TS 与 Rust 静态校验原型均匹配 56/56 的 fixture 预期；Collector 事件 validator 匹配 39/39。
- 纯 Schema 接受 9 个由应用语义拒绝的事件；Collector policy parser 接受两份 Schema 判为无效的 date-time 文档。
- typify 原始 Serde 接受空 origins、重复 origins 和 `schema_version=2`；显式规则原型覆盖了这些约束。
- Collector Rust 事件结构反序列化再序列化时，10/12 个有效事件样本生成 Schema 不接受的 `null`；Page View 模型也不保留 Schema 允许的扩展字段。
- 差异、逐例结果、命令与限制见[第六步报告](m0b-step6-parity-report.md)和[逐 fixture 矩阵](m0b-step6-parity-matrix.tsv)。

## 后续实施任务

| 归属 | 工作                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| M2   | 固定并接入 TypeScript 与 policy Rust 生成工具；提交产物，提供无漂移 `--check`，接入 typecheck/compile 和共享 parity 门禁。            |
| M2   | 对 Stored Environment Policy 增加生成模型未表达约束的显式校验；启动时构造并复用 policy validator，保留现有 last-good/stale 错误语义。 |
| M2   | 决定 Collector 对 Schema 无效 date-time 的处理是否与 Schema 对齐；在作出决定前保持当前生产接受行为。                                  |
| M9   | 将 Collector event wire model 迁移到版本化静态类型与显式校验；保留 Schema/fixture CI 验证后再评估移除生产 Schema validator。          |
| M9   | Rust Page View 保留 Schema 允许的扩展字段；可选字段缺省时序列化为省略属性而非 `null`，并用 wire round-trip parity 验收。              |

生成器、`--check` 和 parity CI 的生产接入均不属于 M0b 收尾；M2/M9 实施时完成。上述任务实施前，M0b 阶段未替换生产类型、运行时验证或构建流程。
