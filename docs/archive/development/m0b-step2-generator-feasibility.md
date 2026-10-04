# M0b 第二步：Schema 类型生成可脚本化试验

## 输入和固定工具

输入沿用[第一步基线](m0b-step1-sample-baseline.md)：Event Batch V1（含三种事件和 Browser Context）及 Stored Environment Policy V1。入口 SHA-256 见[生成结果清单](../../../experiments/m0b/generated/results.json)。本试验未修改生产 Schema、类型或运行时校验。

| 工具                                                                                           | 固定版本与依赖                                                                                                      | 许可证     | 调用入口                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| [Schema Transformation Toolkit](https://github.com/bearfighting/schema-transformation-toolkit) | commit `825f4398e125f586354a18ba575d4d37edc5c745`，SDK `0.7.0`；该 commit 内的 `pnpm-lock.yaml`                     | Apache-2.0 | SDK `convert`，由脚本加载构建后的 `packages/sdk/dist/index.js` |
| [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript)              | `16.0.0`；[试验专用 npm lockfile](../../../experiments/m0b/ts-generator/package-lock.json) 固定全部依赖和 integrity | MIT        | `dist/src/cli.js --input … --output …`                         |
| [cargo-typify](https://github.com/oxidecomputer/typify/tree/main/cargo-typify)                 | `0.8.0`，`cargo install --locked` 使用该 release 的 Cargo.lock                                                      | Apache-2.0 | `cargo-typify typify --no-builder --output … SCHEMA`           |

试验环境为 Node `v26.2.0`、pnpm `12.6.0`、仓库锁定 Rust `1.98.1`。Toolkit manifest 的 SDK 入口经该 commit 的实际 `packages/sdk/package.json` 与构建产物核对。工具只装在隔离试验目录；`experiments/m0b/ts-generator` 仅存试验 npm manifest/lockfile，不进入生产 workspace 依赖。

首次安装命令（在仓库根目录执行）：

```sh
git clone https://github.com/bearfighting/schema-transformation-toolkit.git /tmp/m0b-schema-transformation-toolkit
git -C /tmp/m0b-schema-transformation-toolkit checkout 825f4398e125f586354a18ba575d4d37edc5c745
pnpm -C /tmp/m0b-schema-transformation-toolkit install --frozen-lockfile
pnpm -C /tmp/m0b-schema-transformation-toolkit build
npm ci --prefix experiments/m0b/ts-generator
cargo install cargo-typify --version 0.8.0 --locked --root /tmp/m0b-typify
```

执行与检查命令：

```sh
node scripts/m0b-generation-trial.mjs --toolkit-root /tmp/m0b-schema-transformation-toolkit --json2ts-root experiments/m0b/ts-generator --typify-bin /tmp/m0b-typify/bin/cargo-typify --output-dir artifacts/m0b-generator-trial/repro-a --snapshot
node scripts/m0b-generation-trial.mjs --toolkit-root /tmp/m0b-schema-transformation-toolkit --json2ts-root experiments/m0b/ts-generator --typify-bin /tmp/m0b-typify/bin/cargo-typify --output-dir artifacts/m0b-generator-trial/repro-b --check
```

`--output-dir` 必须为空。脚本生成原始输入的诊断、成功产物、`results.json`，保存在被 Git 忽略的 `artifacts/m0b-generator-trial/`；`--snapshot` 将成功产物复制到[评估样本](../../../experiments/m0b/generated/results.json)。生成器各自完成代码格式化，脚本没有手工后处理。更新样本时显式使用 `--snapshot`，正常检查使用 `--check`。

## 输入处理与结果

事件 Schema 的 `$id` 声明 `schemas/events/` 与 `schemas/contexts/` 的相对层级，但仓库物理目录不同。`json2ts` 直接读取原路径时在解析 `../contexts/browser-context.schema.json` 报 `ERESOLVER/ENOENT`。脚本先保留这次失败诊断，然后按 `$id` 层级复制五份**字节完全相同**的 Schema，再调用同一 CLI；逐文件 SHA-256 校验副本。配置直接用仓库原文件。

脚本另试确定性的本地 `$ref` 打包：把所有外部引用映射至根 `$defs`，保持同一 2020-12 方言，重定向 Context 内部引用；原始与打包版由 Ajv 对 28 个现有事件 fixture 比较，结果一致。这只是当前 fixtures 的回归证据，不能单独证明对所有 JSON 等价。打包输入仍未让 Toolkit 或 typify 成功，所以它不属于任何成功路径，也不用于已提交生成样本。

| 路径        | 原始输入 / 可脚本化处理结果                                                                                                                                                                                                                                             | 本步结论                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 事件 → TS   | Toolkit 在 parse 阶段拒绝外部 `$ref`；`json2ts` 原始路径因物理目录与 `$id` 不一致失败，字节相同的 staged 输入成功生成[事件 TS](../../../experiments/m0b/generated/json2ts/event.ts)                                                                                     | **可脚本化生成**；类型语义质量待第 3、6 项                                                         |
| 配置 → TS   | Toolkit 生成[配置 TS](../../../experiments/m0b/generated/toolkit/policy.ts)，报告 2 项 caveat、13 项 constraint loss；输出将 `schema_version`、`allowed_origins` 改为 camelCase。 `json2ts` 原始输入生成[配置 TS](../../../experiments/m0b/generated/json2ts/policy.ts) | `json2ts` **可脚本化生成**；Toolkit **有损输出**，不能视为完整支持                                 |
| 事件 → Rust | Toolkit 原始输入在 parse 阶段拒绝外部 `$ref`；typify 原始输入因外部引用 panic（exit 101）。打包后 Toolkit 拒绝嵌入 Schema 的 `title` 关键字；typify 继续因 `if/then/else` 不支持而 panic（exit 101）                                                                    | 本次候选**明确不支持完整生成**，不能通过删约束取得成功                                             |
| 配置 → Rust | Toolkit generate 阶段拒绝 literal Rust node；typify 原始输入生成[配置 Rust](../../../experiments/m0b/generated/typify/policy.rs)                                                                                                                                        | typify **可脚本化生成**；`schema_version` 变成 `serde_json::Value`，显然有损，是否可用待第 3、6 项 |

Toolkit 的问题分层、逐项损失和产物差异见[Toolkit 专项报告](m0b-toolkit-findings.md)；原始诊断及其他工具的 stderr 见每次运行的 `diagnostics/`。脚本会在 `results.json` 中记录失败阶段、代码或退出码。专用工具没有同等级的 constraint-loss 报告；“生成成功”仅表示产出文件，不表示无损或通过类型编译。

## 重复性与基线

两个干净输出目录 `repro-a`、`repro-b` 的四份成功产物和 `results.json` 均逐字节相同。第二次运行的 `--check` 退出 0；复制评估样本到 `/tmp/m0b-generated-stale`，在 `json2ts/event.ts` 末尾加入 `// stale` 后以 `--sample-dir /tmp/m0b-generated-stale --check` 重跑，退出 1 并准确报告该文件过期。无需 AI 或手工改生成文件。

`pnpm protocol:validate` 退出 0：事件、配置 fixtures 及 contract 检查均按原基线通过。TS/Rust 编译、Serde wire 行为、完整 fixture parity 继续由 checklist 第 3、6 项验证。本步不据此选择生产方案。
