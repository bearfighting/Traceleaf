# Contract validator 重构试点

本记录对应代码重构 Checklist 工作包 6.3。重构保留 CLI 文件路径、根 `package.json` 命令、fixture 与 schema、诊断内容和退出状态。

## 重构前基线（2026-10-07）

运行时 validator 与 schema/fixture baseline 检查是两类独立职责。五个运行时命令分别验证 Analytics API、Configuration、HTTP ingestion、Event Protocol 和 Analytics definitions 合同；`check-contract-fixture-schema-baseline.mjs` 与各类 schema parity 检查另行比较已登记的 schema/fixture 基线。本次没有把 baseline 检查并入运行时 validator，也没有修改调用者或执行顺序。

运行时 validator 基线如下，五项均以 Node CLI 直接执行并退出码 0：

| 命令                                                           | 输入与覆盖范围                                                                                                                                                            | 成功输出                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `node ./tooling/contracts/validate-analytics-api-contract.mjs` | `docs/analytics-api.openapi.json`、Analytics API contract cases 与 `protocol/contracts/analytics-api/current/fixtures/*.json`；OpenAPI、查询错误案例、聚合和 API 响应语义 | `Validated analytics contract and 11 fixtures.`                                                |
| `node ./tooling/contracts/validate-configuration-contract.mjs` | Configuration schemas、capability manifest、Configuration fixtures、语义案例、迁移映射、站点管理和 OpenAPI                                                                | 逐项 `PASS`，末行为 `Configuration contracts validated successfully.`                          |
| `node ./tooling/contracts/validate-http-fixtures.mjs`          | `protocol/contracts/http-ingestion/current/fixtures/*.json`；请求/场景、setup 和响应语义                                                                                  | `Validated 30 HTTP fixtures.`                                                                  |
| `node ./tooling/contracts/validate-protocol.mjs`               | `protocol/events/{schemas,fixtures}` 与 browser context schema；Ajv schema 加 custom-event、Web Vital 和 batch 语义                                                       | 每个 fixture 输出 `PASS` / `EXPECTED FAIL`，末行为 `Protocol fixtures validated successfully.` |
| `node ./tooling/contracts/validate-analytics-definitions.mjs`  | Analytics definitions JSON Schema 和附加断言                                                                                                                              | `Analytics definitions match their schema.`                                                    |

失败诊断保持原有 validator 文本、顺序和汇总方式；失败时写入 stderr 并设置退出码 1。CLI 路径及 package script 未变。

## 模块职责

- Analytics API facade 继续按 OpenAPI、query cases、排序后的 analytics fixtures 顺序读取输入并汇总错误。规则分别位于 `analytics-openapi-validation.mjs`、`analytics-query-case-validation.mjs` 和 `analytics-fixture-validation.mjs`。
- Configuration facade 仍负责加载 schemas、manifest 和 OpenAPI，并维持原输出顺序；schema fixture 遍历和语义校验位于 `configuration-fixture-validation.mjs`。
- HTTP facade 负责排序、读取 fixture、缺失 ID 检查、诊断汇总；请求结构、scenario body 与 setup 校验位于 `http-fixture-validation.mjs`，响应语义继续由 `http-response-semantics.mjs` 处理。
- Protocol facade 负责 schema 初始化、valid/invalid 目录顺序和最终退出码；fixture 选择、Ajv 结果与协议语义交叉检查位于 `protocol-fixture-validation.mjs`，custom-event 与 Web Vital 规则继续由 `protocol-event-semantics.mjs` 处理。
- capabilities validator 的边界已集中在单个 manifest 的 schema、依赖关系和 cycle 检查；analytics-definitions validator 是单个 schema 与少量附加断言。拆开这两者不会形成独立输入或职责，因此保留单文件。

## 验收

重构后五个 Node CLI 均成功，成功输出与上述基线一致。命令顺序、输入路径、fixtures、schemas 和 package scripts 未修改。仓库级 `pnpm check`、`pnpm test`、`pnpm format:check` 和 `pnpm format:check:docs` 均通过；该结果作为 2026-10-07 本地验收记录。此记录只关闭 checklist 6.3，不代表工作包 6 整体验收完成。
