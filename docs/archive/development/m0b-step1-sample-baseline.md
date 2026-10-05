# M0b 第一步：评估样本与验证基线

- 日期：2026-09-29
- 范围：事件 wire contract 与存储的 environment policy contract；不含 HTTP 鉴权、数据库状态和跨文档冲突。
- 运行目录：仓库根目录。

## 样本与消费者

| 样本                         | Schema 入口及引用                                                                                                                                                         | 现有类型与消费者                                                                                                                                                                          | Fixtures                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Event Batch V1               | `protocol/events/schemas/event-batch.schema.json`；通过 `oneOf` 引用 Page View、Custom Event、Web Vital；Page View 再引用 `protocol/contexts/browser-context.schema.json` | TS：`packages/protocol-ts/src/event-batch.ts`、三个事件类型与 `browser-context-v1.ts`；Rust：`services/collector/src/protocol.rs`；Collector 入口：`services/collector/src/validation.rs` | `protocol/events/fixtures/{valid,invalid}/*.json`，11 valid、17 invalid                                           |
| Stored Environment Policy V1 | `protocol/contracts/configuration/current/environment-policy.schema.json`；内部 `$defs/storedKey` 引用                                                                    | 当前无专属 TS wire 类型；Rust：`services/collector/src/runtime_policy.rs` 的 `StoredPolicy`、`StoredKey`，由 `parse_database_policy` 读取数据库 JSONB                                     | `protocol/contracts/configuration/current/fixtures/environment-policy/{valid,invalid}/*.json`，2 valid、8 invalid |

事件样本覆盖外部 `$ref`、`oneOf`、事件判别字段、自由 JSON properties 和按事件类别变化的未知字段策略。存储策略样本覆盖版本常量、内部 `$ref`、嵌套 key、日期格式、Origin 列表、唯一性及严格未知字段策略。Policy update 是另一份 API request contract，可留待后续加测。

## 判定方法与命令

- `node scripts/check-contract-fixture-schema-baseline.mjs`：用 Ajv Draft 2020-12 与 `ajv-formats` 得出**纯 Schema** 判定。顶层有 `type` 的 fixture 对三种事件 Schema 做 `oneOf` 等价判定；其余事件 fixture 进入 batch Schema。Policy fixture 进入存储策略 Schema。此脚本不执行语义规则。
- `pnpm protocol:validate`：现有 `scripts/validate-protocol.mjs` 与 `scripts/validate-configuration-contract.mjs` 对相应 fixtures 的**最终预期判定**均通过；两者在 Schema 外再检查部分语义规则。2026-09-29 运行成功。
- `cargo test -p collector canonical_ -- --nocapture`：Collector 对 11 个有效和 17 个无效事件 fixtures，以及 2 个有效和 8 个无效策略 fixtures 逐例断言；3 个测试通过。2026-09-29 运行成功。
- `cargo test -p collector runtime_policy::tests -- --nocapture`：5 个测试通过，包括全部策略 fixtures、`empty-ingest-keys.json` 的运行时状态检查及数据库行身份不匹配案例。
- `cargo test -p collector canonical_policy_fixtures_match_runtime_parser -- --nocapture`：新增的测试调用真实 `parse_database_policy`，逐例断言全部 2 个有效和 8 个无效策略 fixtures；1 个测试通过。2026-09-29 运行成功。

下表中“语义后”是 Schema 加现有协议/配置脚本规则后的最终判定。对于纯 Schema 已拒绝的输入，后续规则无需执行。`✓` 为接受，`✗` 为拒绝。事件“服务”栏来自上述 Rust fixture 测试；Policy“服务”栏的 `测` 表示已调用 Collector 的策略解析函数逐例验证。Fixture 路径以本节样本表中的目录为根。

### 事件逐例基线

| Fixture                                      | 预期 | 纯 Schema | 语义后 | Collector |
| -------------------------------------------- | :--: | :-------: | :----: | :-------: |
| valid/custom-event-nested-properties.json    |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/custom-event.json                      |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/event-batch-mixed-types.json           |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/event-batch-with-visitor.json          |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/event-batch-with-web-vitals.json       |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/event-batch.json                       |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/page-view-with-context.json            |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/page-view-with-unknown-fields.json     |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/page-view-without-identity.json        |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/page-view.json                         |  ✓   |     ✓     |   ✓    |     ✓     |
| valid/web-vital-event.json                   |  ✓   |     ✓     |   ✓    |     ✓     |
| invalid/batch-invalid-event.json             |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/context-field-too-long.json          |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/context-version-without-context.json |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/custom-event-forbidden-field.json    |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/custom-event-invalid-name.json       |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/custom-event-prohibited-key.json     |  ✗   |     ✓     |   ✗    |     ✗     |
| invalid/custom-event-too-deep.json           |  ✗   |     ✓     |   ✗    |     ✗     |
| invalid/empty-batch.json                     |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/invalid-event-type.json              |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/invalid-occurred-at.json             |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/invalid-visitor-id.json              |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/missing-event-id.json                |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/mixed-site-web-vital-batch.json      |  ✗   |     ✓     |   ✗    |     ✗     |
| invalid/oversized-batch.json                 |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/unsupported-schema-version.json      |  ✗   |     ✗     |   ✗    |     ✗     |
| invalid/web-vital-inconsistent-rating.json   |  ✗   |     ✓     |   ✗    |     ✗     |
| invalid/web-vital-out-of-range.json          |  ✗   |     ✗     |   ✗    |     ✗     |

四个“纯 Schema 接受、语义后拒绝”的案例分别由 Custom Event properties 敏感键、properties 深度、batch 单 Site、Web Vital rating 阈值规则处理。`validate-protocol.mjs` 当前依赖文件名前缀选择 batch validator；`batch-invalid-event.json` 和 `mixed-site-web-vital-batch.json` 因命名未进入 batch validator，但仍得到预期拒绝结果。该选择方式不能用作后续逐规则 parity 的证据；上面的纯 Schema 脚本按顶层 JSON 形状选择入口。

### 存储策略逐例基线

| Fixture                          | 预期 | 纯 Schema | 语义后 | Collector |
| -------------------------------- | :--: | :-------: | :----: | :-------: |
| valid/empty-ingest-keys.json     |  ✓   |     ✓     |   ✓    |   ✓ 测    |
| valid/production.json            |  ✓   |     ✓     |   ✓    |   ✓ 测    |
| invalid/empty-origins.json       |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/fragment-origin.json     |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/ipv4-shorthand.json      |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/leading-zero-port.json   |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/missing-environment.json |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/path-origin.json         |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/query-origin.json        |  ✗   |     ✗     |   ✗    |   ✗ 测    |
| invalid/unicode-origin.json      |  ✗   |     ✗     |   ✗    |   ✗ 测    |

Policy fixtures 中没有“Schema 接受、单文档语义拒绝”的案例。配置脚本还检查规范 Origin；数据库行 `site_id`、`environment`、`version` 与文档一致性由 Collector 检查，但不属于纯文档 Schema。跨 environment 的 Origin 冲突由运行时 registry 和独立的 `policy-semantic-cases.json` 覆盖，也不属于单份 policy fixture 的判定。

## 覆盖盘点与下一步缺口

| 类别              | 当前证据                                                                        | 需补充的最小案例                                                                     |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 必填、可选、union | 缺 `event_id`/`environment`，无身份 Page View，混合事件 batch，非法事件类型     | 配置可选字段不适用于此 policy；后续生成器需确认 required 映射                        |
| 未知字段          | Page View 接受未知字段，Custom Event 拒绝页面字段                               | Policy 顶层与 `storedKey` 的未知字段拒绝；Web Vital 未知字段拒绝；batch 未知字段接受 |
| 动态 JSON 与隐私  | Custom Event 嵌套 properties、敏感键、过深                                      | 非对象 properties、键数/数组长度/字符串字节数/8 KiB 边界                             |
| 格式与范围        | visitor UUID、context 字符串长度、Web Vital 上限、超大/空 batch、Origin pattern | event ID/site ID/path/URL 边界，日期格式，digest/key ID 格式，batch 恰好 100 条      |
| 跨字段与语义      | context 版本配对、Web Vital rating、batch 单 Site、数据库身份不匹配单元测试     | Web Vital Page View 时间晚于报告、policy 行版本不匹配对应 fixture                    |

事件 Collector 构造 JSON Schema validator 时显式启用格式验证；存储策略 validator 当前只指定 Draft 2020-12，没有显式启用格式断言。现有 policy fixtures 也没有无效 `date-time`，因此本基线不能证明两条路径对日期格式的接受结果一致。

这些是评估覆盖缺口，不表示当前生产校验缺失。后续 parity 试验应先补有代表性的 fixtures，再判断生成类型和运行时校验是否等价。
