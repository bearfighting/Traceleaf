# M0b 第六步：TS/Rust 与 Schema parity 结果

- 日期：2026-09-29
- 范围：Event Batch V1（含三类事件及 Browser Context）与 Stored Environment Policy V1。
- 执行方式：`node experiments/m0b/parity/run.mjs`；结果写入 `artifacts/m0b-parity/`，逐 fixture 的受版本控制矩阵为[parity matrix](m0b-step6-parity-matrix.tsv)。
- 边界：隔离原型用于评估，不接入生产 package、crate 或启动流程；无生产 Schema、类型或公共 API 改动。

## 验证通道

| 通道           | 实际执行内容                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema         | Ajv Draft 2020-12 加 `ajv-formats`，逐个调用事件对象 Schema、Event Batch Schema 或 Stored Policy Schema；不混入语义规则。                                                          |
| TS 静态原型    | `experiments/m0b/parity/typescript/static-validator.ts` 手写结构与显式语义检查，覆盖两个样本。不是 `json2ts` 生成类型的运行时 validator；生成类型在第三步已做编译/type probes。    |
| Rust 静态原型  | Event 使用现有 Collector wire model 加隔离的显式校验；policy 使用 typify 类型并补 schema_version、空 origins、唯一性等检查。另单列 typify 原始 Serde 接受结果。                    |
| Collector 当前 | 事件调用真实 `Validator`；policy canonical fixture 结果从 `canonical_policy_fixtures_match_runtime_parser` 定向测试输出读取。                                                      |
| 序列化         | TS 对接受对象执行 JSON stringify/parse round-trip；Rust 对已反序列化 wire model 执行 Serde serialize，再将输出送回 Schema validator。TS round-trip 不代表生成类型自带 serializer。 |

## 样本与总体结果

共有 56 个 canonical fixture：事件 12 valid / 27 invalid，policy 2 valid / 15 invalid。

| 比较                             | 结果                    | 说明                                                                                                                                                    |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema vs fixture 预期           | 47/56 一致              | 9 个事件 fixture 是 Schema 有意接受、额外语义规则拒绝。                                                                                                 |
| TS 静态原型 vs 预期              | 56/56 一致              | 包括 Schema 外的 Custom Event privacy/size、Web Vital 评分/时间关系及 batch 单站点规则。                                                                |
| Rust 静态原型 vs 预期            | 56/56 一致              | 事件使用现有 wire 结构；policy 需在 typify Serde 之后加显式约束。                                                                                       |
| Collector 事件 validator vs 预期 | 39/39 一致              | 只覆盖当前 `Validator` 路径；HTTP 时钟窗口是另一个消费者语义。                                                                                          |
| Collector policy parser vs 预期  | 15/17 一致              | 它接受两份 Schema 拒绝的无效 date-time 文档。                                                                                                           |
| typify 原始 Serde vs 预期        | 14/17 一致              | 接受空 origins、重复 origins 和 schema_version=2；Rust 原型增加显式检查后与预期一致。                                                                   |
| Rust Serde 输出 vs Schema        | 2/12 个有效事件输出通过 | 10 个失败样本都含未提供的 `Option` 字段；Serde 输出了 JSON `null`，而 Schema 不允许这些属性为 null。两个有效 policy 与 Web Vital 等无可选字段样本通过。 |

Schema、TS 静态、Rust 静态及 Collector 当前通道之间有 11 个 fixture 至少出现一个不同判定：9 个为 Schema 与应用语义边界，2 个为 Collector policy date-time 缺少 format assertion。原始 typify Serde 另有 3 个候选差异，已由 Rust 静态原型中的显式规则拒绝。

## 差异与处置

| Fixture / 规则                                                                                                                                                                                                                                      | Schema   | 静态 / 语义结果                                    | Collector 当前         | 原因与处置                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom-event-prohibited-key.json`、`custom-event-too-deep.json`、`custom-properties-array-over-maximum.json`、`custom-properties-over-key-count.json`、`custom-properties-over-serialized-size.json`、`custom-properties-string-over-maximum.json` | 接受     | TS/Rust 拒绝                                       | 拒绝                   | Schema 只声明动态 JSON object；隐私、深度、数量和序列化大小是应用语义。保留 Schema 与语义判定分列。                                                             |
| `mixed-site-web-vital-batch.json`                                                                                                                                                                                                                   | 接受     | TS/Rust 拒绝                                       | 拒绝                   | 单 batch 单 site 是跨事件业务规则。                                                                                                                             |
| `web-vital-inconsistent-rating.json`、`web-vital-page-view-after-report.json`                                                                                                                                                                       | 接受     | TS/Rust 拒绝                                       | 拒绝                   | rating 对应关系和 Page View 时间先后未在 Schema 表达；protocol CI 验证脚本已覆盖这两条语义。                                                                    |
| `invalid-updated-at-date-time.json`、`invalid-key-created-at-date-time.json`                                                                                                                                                                        | 拒绝     | TS/Rust 拒绝                                       | **接受**               | `runtime_policy.rs` 的 JSON Schema builder 未启用 formats，存储模型把日期作为 `String`。为保留当前行为，policy 定向测试明确锁定这两个结果；本步不改变生产校验。 |
| `empty-origins.json`、`duplicate-origins.json`、`unsupported-schema-version.json`                                                                                                                                                                   | 拒绝     | typify 原始 Serde **接受**；补充静态校验后拒绝     | 拒绝                   | typify 未表达最少一项、uniqueItems 与 schema_version const。静态 policy 原型对三项显式验证。                                                                    |
| 有缺省可选字段的 Page View/Custom Event 反序列化再序列化                                                                                                                                                                                            | 接受输入 | 输入通过 Rust 静态校验；序列化输出多为 Schema 拒绝 | Collector 事件校验输入 | 当前 Rust structs 的 `Option<T>` 缺省时序列化为 `null`。候选生成/正式迁移需决定 omission 属性并加 wire round-trip test；本步不修改生产模型。                    |

生成器限制仍需一并考虑：Step 3 的 `version > u64::MAX` 探针显示 typify 因 `NonZeroU64` 上界拒绝该值，而 Schema 没有最大值；数据库行版本实际为有界整数，因此该边界不是单文档 canonical fixture。TS 使用 JavaScript `number` 也不能精确表示任意大的 JSON integer。该限制留给第七项 contract 决策，不视为此处已消除。

另一个 wire 保留差异来自 `valid/page-view-with-unknown-fields.json`：Schema 接受 Page View 扩展字段，但当前 Rust `PageViewEvent` 没有扁平 extension map，Serde 解析后再序列化会丢掉这些字段。Collector 当前请求路径另存原始 `payload`，因此这项不等同于当前 ingest 丢字段；隔离类型 round-trip 不能承诺未知字段保留。

## 跨文档语义和覆盖

- 数据库行 `site_id`、`environment`、`version` 与 policy JSON 一致性不能由单文档 Schema 表达。Collector 定向测试现覆盖 Site mismatch 和 version mismatch / match 两侧。
- 跨 environment Origin 冲突在 `protocol/contracts/configuration/current/fixtures/policy-semantic-cases.json` 独立覆盖，并由 `pnpm protocol:validate` 执行；没有把它伪装成 policy Schema fixture。
- 新增 canonical fixtures：Event Batch 恰好 100 项；Event ID 格式；Context 维度边界及未知字段；Custom properties 非对象、数组/字符串/key/序列化大小限制；Web Vital 闭合字段与时间关系；Policy date-time、schema version、空 site id、重复 Origin 和 root/nested 未知字段。

## 可重跑命令及结果

```sh
node experiments/m0b/parity/run.mjs
pnpm protocol:validate
pnpm --filter @web-analytics/protocol-ts test
pnpm --filter @web-analytics/protocol-ts typecheck
cargo test -p collector canonical_ -- --nocapture
cargo test -p collector runtime_policy::tests -- --nocapture
cargo fmt --check --manifest-path services/collector/Cargo.toml --package collector
cargo check --offline --locked --manifest-path experiments/m0b/parity/rust/Cargo.toml
```

上述 parity runner、protocol validation、TS tests/typecheck、Collector canonical/runtime-policy tests、Rust isolated compile 均通过。`pnpm protocol:validate` 的 Web Vital semantic helper 增加了 Page View timestamp 顺序检查以覆盖新 canonical fixture；这只是 CI/开发校验脚本，不改变 Collector production path。

## 结论

隔离 TS/Rust 校验原型能在新增的 56 个样本上匹配 fixture 的有效/无效预期；但这不证明现有生成类型可直接承担运行时校验。Collector 当前 policy date-time 格式接受行为与 Schema 不一致，typify 原始 Serde 存在三项缺失约束，现有 Rust event wire model 的可选字段序列化也会产生 Schema 不接受的 `null`。这些差异均已明确定位，留给第七项按 contract 作类型来源、未知字段、serializer 与 CI 门禁决策。本步没有修改生产校验规则或公共 API。
