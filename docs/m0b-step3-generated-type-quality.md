# M0b 第三步：已生成类型质量评估

## 验证环境与命令

所有代码和编译产物在 Git 忽略的 `artifacts/m0b-type-quality/`。生成样本未改动。TypeScript 检查入口 `types.ts` 同时导入三份已生成 TS 样本和当前 `packages/protocol-ts` 公共类型；使用仓库 TypeScript 6.x、ESNext/Bundler 模式：

```sh
pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler artifacts/m0b-type-quality/types.ts
pnpm --filter @web-analytics/protocol-ts typecheck
cargo run --offline --manifest-path artifacts/m0b-type-quality/rust/Cargo.toml
pnpm protocol:validate
```

上述命令均退出 0。Rust 临时 crate 使用 Rust `1.98.1`，serde `1.0.229`、serde_json `1.0.151`、chrono `0.4.45` 均取自仓库 Cargo.lock 的版本；生成代码另需 regress `0.12.0`。Rust crate 编译了未修改的 [typify 配置样本](../experiments/m0b/generated/typify/policy.rs)，并读取仓库 environment-policy fixtures。Serde 输出保存在 `artifacts/m0b-type-quality/serde-results.tsv`。

## TypeScript 结果

json-schema-to-typescript 事件、json-schema-to-typescript 配置和 Toolkit 配置 TS 均通过严格编译；现有 `protocol-ts` package 的独立 typecheck 也通过。类型探针用 `@ts-expect-error` 检查应被静态拒绝的形状，并以成功编译证明类型允许的形状。这里验证的是声明层行为，不是 JSON 运行时验证。

| 检查项                   | 观察结果                                                                                                                                                                                                       | 对照                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 字段必填、常量和事件类型 | Event Batch 的 `schema_version: 1`、事件 `type` 字面量均可用；错误 discriminator、缺少 Page View 的必填 `path` 和 `context: null` 均被拒绝。json2ts 的 batch 用非空 tuple 表达 `minItems: 1`，空事件数组被拒绝 | 生成的 Event Batch 类型对这几项表达较好                                                                                     |
| Page View 条件字段       | 生成类型接受只有 `context` 或只有 `context_schema_version` 的对象                                                                                                                                              | 当前 `packages/protocol-ts` 的 PageViewEvent 将两字段成对建模，并拒绝该不完整组合；Schema 也要求成对                        |
| 未知字段 / 动态 JSON     | Event Batch 和 Page View 的 extension 字段可通过类型检查；Custom Event 顶层未知字段被拒绝，其 properties 仍接受嵌套任意值和 `email` 键                                                                         | 对应 Schema 允许 Page View / batch 扩展字段；Custom properties 的隐私、深度、大小等由已有运行时语义校验负责，静态类型不表达 |
| 配置格式、范围和模式     | json2ts 配置类型接受空 `site_id` / `environment`、负 `version`、无效日期、无效 origin 和零 rate limit                                                                                                          | 普通 `string` / `number` 未表达这些 JSON Schema 约束                                                                        |
| Toolkit 配置键名         | camelCase Toolkit 类型可编译；wire snake_case 对象不能赋给该类型                                                                                                                                               | 与 wire JSON 不兼容；此前 Toolkit 专项报告已详述                                                                            |
| 当前 package 对照        | 现有 PageView 类型拒绝 context 字段不成对；现有 EventBatch 类型接受空 events 数组                                                                                                                              | 前者比 json2ts 生成类型准确；后者没有表达 Schema 的非空集合约束                                                             |

json2ts 配置的 `allowed_origins` 用非空 tuple 表达 `minItems`；Origin pattern、重复值、日期格式、整数性和数值边界仍需运行时校验。Toolkit 的字段重命名仍是直接 wire 使用的阻断问题，即使其 TS 语法和类型本身可编译。

## Rust / Serde 结果

typify 配置类型在隔离 crate 中编译成功。Serde 对现有 fixtures 的结果如下：

| Fixture                          | Schema 结果 | typify Serde | 对照                                           |
| -------------------------------- | ----------- | ------------ | ---------------------------------------------- |
| valid/production.json            | 接受        | 接受         | 一致                                           |
| valid/empty-ingest-keys.json     | 接受        | 接受         | 一致                                           |
| invalid/empty-origins.json       | 拒绝        | **接受**     | 差异：Rust 字段是普通 `Vec`，未执行 `minItems` |
| invalid/missing-environment.json | 拒绝        | 拒绝         | 一致                                           |
| invalid/fragment-origin.json     | 拒绝        | 拒绝         | 一致                                           |
| invalid/path-origin.json         | 拒绝        | 拒绝         | 一致                                           |
| invalid/query-origin.json        | 拒绝        | 拒绝         | 一致                                           |
| invalid/unicode-origin.json      | 拒绝        | 拒绝         | 一致                                           |
| invalid/ipv4-shorthand.json      | 拒绝        | 拒绝         | 一致                                           |
| invalid/leading-zero-port.json   | 拒绝        | 拒绝         | 一致                                           |

另对有效 production 文档作单点变异，确认边界：

| 变异                             | typify Serde | 说明                                                          |
| -------------------------------- | ------------ | ------------------------------------------------------------- |
| 增加未知根字段                   | 拒绝         | `deny_unknown_fields` 与 Schema 闭合对象一致                  |
| 增加未知嵌套 key 字段            | 拒绝         | StoredKey 也拒绝未知字段                                      |
| 移除必填 `site_id`               | 拒绝         | 必填字段一致                                                  |
| `version = 0`                    | 拒绝         | `NonZeroU64` 执行正数约束                                     |
| `updated_at = "not-a-date"`      | 拒绝         | chrono 日期类型拒绝无效日期                                   |
| `schema_version = 2`             | **接受**     | 生成字段为 `serde_json::Value`，未保留 Schema 的 `const: 1`   |
| `allowed_origins = []`           | **接受**     | 未表达 `minItems: 1`                                          |
| 重复 origin                      | **接受**     | Vec 未表达 `uniqueItems: true`                                |
| `version = 18446744073709551616` | **拒绝**     | 目标 `NonZeroU64` 有上界；Schema 只规定 minimum，没有 maximum |

Serde 对 Origin regex 的现有无效样本均拒绝；这来自 typify 生成的字符串包装类型。整数表示则存在双向不一致：`schema_version` 过宽，普通正整数却被限制到 u64 范围。生成出的配置结构体虽然实现了 Serde，但不能单独作为与 Schema 完全等价的校验器。

## 结论及下一步

- TS 样本都能编译；json2ts 保留 wire 键名、判别 union 和 batch 非空 tuple，但丢失 Page View 条件配对及字符串/数值/动态属性上的运行时规则。现有 `protocol-ts` 在 context 配对处更准确，在 batch 最小长度处更宽。
- Toolkit 配置 TS 可编译，但字段 camelCase 与 wire contract 不匹配，不能直接用于当前协议对象。
- typify 配置 Rust 可编译且对多项格式、正数、必填和闭合对象规则有 Serde 行为；然而它接受 Schema 禁止的空/重复 origins 和非 1 schema version，也拒绝 Schema 允许的 u64 以上整数。
- 本步只覆盖配置 Rust 的现有 fixtures 和选定边界探针。完整 TS/Rust/Schema fixture parity 仍属于 checklist 第 6 项；事件 Rust 没有生成产物。

因此，本步没有通过“类型质量可直接取代现有类型或运行时 Schema 验证”的门槛。json2ts TS 与 typify Rust 可以继续作为生成候选评估，接入前需明确保留哪些现有手工语义类型、哪些输入仍须运行时 Schema validator 检查。
