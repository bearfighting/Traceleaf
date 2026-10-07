# Rust Processor 流水线重构试点

本记录对应[代码重构 Checklist 工作包 5](./code-refactoring-checklist.md#工作包-5rust-processor-流水线)。本工作包整理 Processor 内部职责和集成测试组织，保持事件处理、事实生成、definitions、rebuild/backfill、generation 与队列的现有行为。不得借职责搬移修改统计口径、schema、migration、CLI 或 public API；发现产品语义需要变化时另立任务。

## 工作包 5.1 实施前静态复核（2026-10-06）

本节记录 Processor crate、调用方和测试组织的静态梳理；不表示实现已经拆分或 PostgreSQL 行为已经在本轮重新验证。

### 当前职责与依赖方向

- `services/processor/src/lib.rs` 导出 `Processor`、`ProcessorError`、definitions 类型、runtime/capability 类型及纯 parser/normalizer/sessionizer API。`Processor` 实例持有 PgPool、definitions 来源模式和 `CapabilityRuntime`；这些字段、`RebuildRequest` 与 SQL helpers 应继续私有。
- `processor.rs` 约 1,805 行，目前混合连接及 definitions import、常规 raw event 消费、conversion/funnel/custom event/Geo/Web Vitals facts、队列领取、generation rebuild/activation/rollback，以及 SQL 写入和聚合 helper。其 pub 方法是主外部边界，内部 `process_event`、rebuild implementation、watermark、lock、fact writers 为私有实现。
- 底层已有 `parser.rs`、`normalizer.rs`、`sessionizer.rs`、`definitions.rs`、`queries.rs`、`models.rs`、`capabilities.rs`。parser/normalizer/sessionizer 是不依赖 PgPool 的纯计算边界；`queries.rs` 提供数据库查询/标记 helper。拆分时避免 Processor orchestration 反向成为纯阶段依赖。
- 主流程有两类：普通事件处理以 received-at 顺序读取 raw events，在事务内根据 capability、definitions、UA/context 生成 facts 并标记 processed；完整站点 generation rebuild 持 site advisory lock，构建 generation/facts/rollups/watermarks 后在事务末尾切换 active/retired 状态。具体事务 statement 顺序须在 5.2/5.3 移动前逐方法抄录并与 SQL 对照。
- 显式 rebuild 涵盖 conversion/funnel、custom event、Geo 和 Web Vitals；definitions 另有 import-if-empty、版本查询/选择和 revision/effective-time 语义。部分写入会清理或推进独立 watermarks，并可能触发相关 facts rebuild，不能单看单个 SQL helper 搬移。
- rebuild queue 涉及 site scope、advisory lock、并发 worker、enabled capability 再检查、暂停/恢复、failed/completed 状态和 retry。generation 是完整站点快照；session IDs 包含 generation ID，不能将局部生成的 session 事实并入另一个 generation。

### PostgreSQL 测试场景盘点

`services/processor/tests/processor.rs` 当前约 1,340 行、16 个串行 PostgreSQL tests。按场景可归组如下；函数名列表留在 Rust 源码中，避免将历史阶段名传播到新目录/模块命名：

| 行为域                                   | 已有覆盖                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation build / activation / rollback | rollback 只选择退役目标；generation rebuild 不修改 raw payload；daily facts 与 generation facts 的发布                                                   |
| Capability gate / rebuild queue          | disabled features 保持 page-view 流程；disabled capability 暂停待处理 rebuild；相同 site/scope 去重；并发 worker 不发布重复 generation；恢复后按规则运行 |
| Watermark / lateness / isolation         | 超过 24 小时的迟到事件等显式 backfill；UTC 日期及 site 隔离；失败聚合不标记 raw event processed                                                          |
| 普通处理与事实重建                       | daily routes/totals 原子更新；一次性 CLI 处理 backlog；Geo facts 从已保存 enrichment 重建；disabled custom event 只标记输入已处理而不写 facts            |
| Definitions                              | 按 received_at/definition revision 处理；definitions import-if-empty 及显式 CLI import 幂等                                                              |

`services/processor/tests/canonical_fixtures.rs` 是独立 PostgreSQL integration target，验证 canonical event fixtures 对应的聚合结果；不应与行为测试共用一套宽泛 assertion helper。两个 integration targets 均由 `pnpm test:integration` 迁移数据库后串行运行。

### 实施前必须明确的事务和原子性问题

- `import_definitions_if_empty`：每个 site 各开事务，先 `lock_site`，再检查是否已有 revisions；已存在则 rollback 并跳过，否则插入 revision 1 和 audit 后 commit。输入验证发生在循环/写库之前。
- `process_one`：开始 SQLx transaction 后由 `claim_next_event` 领取 raw event；没有事件时 rollback 返回 `false`。读取 capability snapshot、按 `received_at` 加载 definition revision 并在同一 transaction 中执行 facts、queue/watermark、processed marker；成功后 commit。能力读取失败显式 rollback；其余 `?` 错误依赖 transaction drop 回滚。`process_all_once` 先循环处理 raw events，再循环处理 rebuild queue。
- `rebuild_custom_event_facts`：capability 检查在事务外；事务内 `lock_site` → delete/reinsert custom facts → 推进 custom watermark 并清除 conversion/funnel definition watermark → commit。若使用文件 definitions，conversion/funnel rebuild 是随后单独开启的另一事务。
- `rebuild_conversion_funnel_facts_with_mode`：capability snapshot 在事务外读取；事务内 `lock_site` → 按 explicit backfill / activation window 删除目标事实 → 读取已处理 custom events → 回填 session IDs 和 conversion/funnel facts → 推进 definition watermarks → commit。遇到无效事件或 SQL 错误时 transaction drop 回滚全次 rebuild。
- Geo 与 Web Vitals explicit rebuild：均在事务外检查 capability，事务内 `lock_site`、delete/repopulate facts 并 commit；Web Vitals 另外在同事务推进 watermark。两者不共享通用 rebuild transaction。
- `enqueue_rebuild`：scope 验证后单条 autocommit insert/upsert，无显式 transaction 或 `lock_site`；活动队列的去重/合并由数据库 unique conflict target 完成。
- `process_rebuild_queue_once`：transaction 内 `FOR UPDATE SKIP LOCKED` 选 queue row、检查 capability、设 running/attempts 并 commit；之后 generation rebuild 使用另一个 transaction。paused/无 capability 时先 rollback，保持 pending；rebuild 成功后（文件 definitions 模式）conversion/funnel rebuild 再用独立 transaction；失败记录由 rebuild 错误路径及 queue handler 在主事务之外更新。
- `rebuild_inner`：单个 transaction 内先 site advisory xact lock，再锁/复查 queue row 与 capability（paused 时写回 pending 并 commit）；读取 site events/watermark 后插入 building generation，锁当前 active generation，写 facts/rollups/watermarks，retire 旧 generation、activate 新 generation、按 scope 完成 queue，最后 commit。build error 使该 transaction 回滚；外层 `rebuild` 随后尝试另行插入 failed generation 并更新 queue failure reason。
- `rollback_generation`：独立 transaction 先 `FOR UPDATE` 校验目标必须 retired，再锁 active generation，依次 retire 当前 active / activate target 并 commit；这里使用 generation 行锁，未调用 `lock_site`，也不复制 facts。
- Definition version rebuild 先读并验证选定 revision，再克隆 Processor 使用该版本执行 conversion/funnel explicit rebuild；该 rebuild transaction 的边界同 `rebuild_conversion_funnel_facts_with_mode`。

上述是移动前源码静态追踪得到的现有边界；需在每个实现子切片中用 PostgreSQL tests 验证相应的回滚、并发/行锁及可见性约束，且搬移后复核 transaction 所有权未改变。不可因为本表描述 autocommit 或独立事务而顺手合并事务。

## 工作包 5.2 事件处理与事实写入拆分（2026-10-07）

- 单事件编排已移至 `services/processor/src/event_processing.rs`。`process_one` 继续开启并拥有 transaction：claim event、读取 capability snapshot、按 `received_at` 选择数据库 definitions revision（或复用文件 definitions）、调用 facts 写入并成功后 commit；claim 为空和 capability 读取失败仍显式 rollback，其他处理错误继续由 transaction drop 回滚。`process_all_once` 仍先 drain raw events，再处理 rebuild queue。
- 单事件事实逻辑已移至 `services/processor/src/event_facts.rs`，包括 activation gate、Page View 聚合 / rebuild enqueue / Geo fact / watermark、Custom Event 与 conversion/funnel facts、Web Vital fact。事实处理及共享的 conversion/funnel watermark helper 通过显式 `&mut Transaction` 工作，不开启、提交或回滚 transaction。`lock_site` 与 revision loader 仍由 Processor 实现提供；Processor 公共导出及方法签名不变。
- 保持了 capability 与 activation gate、definition revision 选择、advisory lock、watermark、幂等写入及 processed marker 的调用次序。共享 facts helper 的显式 rebuild 调用仍处于原位置；显式 rebuild 和 generation rebuild 未搬移。
- `failed_aggregate_update_leaves_event_unprocessed` 现使用带 visitor 的 Page View，并通过队列表 CHECK constraint 令失败发生在 daily、route、total 聚合写入后、enqueue 阶段；断言 Page View 聚合、rebuild queue 与 raw event `processed_at` 均无残留。
- 已运行 `cargo fmt -- --check`：通过；`cargo test -p processor --lib`：8 passed；`cargo test -p processor --test processor`：target 编译通过，但 16 个 PostgreSQL cases 均按配置 ignored。已尝试 `pnpm test:integration`，脚本因缺少 `DATABASE_URL` 提前退出，故 PostgreSQL 行为用例（包括加固的 rollback case）本轮未执行。未运行 workspace checks 或 `pnpm e2e:analytics`，按 5.6 统一验收计划保留。

- Static test review 需找出对原子可见性、并发 workers、late event、capability race、失败重试和 rollback 的直接断言；如缺口影响本次搬移保护，先加最小行为测试再拆分。

## 工作包 5.3 Generation rebuild / rollback 拆分（2026-10-07）

- `services/processor/src/generation_rebuild.rs` 现在承载 `RebuildRequest` / `RebuildSummary`、队列领取与入队、显式 `rebuild_site` 的 generation 协调、rollback，以及 generation watermark、rollup、完整站点事实构建与失败记录 helpers。`Processor` 仍是实例状态和 public API 宿主；新增模块只通过 `impl Processor` 访问同一实例字段，不修改 crate 导出、方法签名、schema、migration、CLI 或 tests target。
- `process_rebuild_queue_once` 的事务仍为：开启事务 → `FOR UPDATE SKIP LOCKED` 领取 incremental row → 查询 capability → 不可用时 rollback 保持 pending，或写 running/attempts 后 commit → 调用另一事务执行 rebuild。成功后的文件 definitions conversion/funnel rebuild 仍为独立事务；错误路径仍在 generation transaction 回滚后尝试写 failed generation / queue，再由 queue handler 更新 failure reason。
- `rebuild_inner` 的顺序未变：开启 generation transaction → site advisory xact lock → 锁定并复查 queue row / capability，暂停时写回 pending 并 commit → 加载完整站点 events 和 continuous watermark → 插入 building generation → `FOR UPDATE` 读取 active generation → 读取 capability 并构建 enabled facts、复制 disabled facts、刷新 rollups、写 generation watermarks → retire 原 active → activate 新 generation → 同事务完成相应 queue rows → commit。新 generation 和事实直到 commit 前不可由其他事务观察为 active。
- `rollback_generation` 继续使用独立事务与 generation 行锁，不调用 site advisory lock：先 `FOR UPDATE` 校验 target 存在且 retired，再 `FOR UPDATE` 当前 active，按 retire current → activate target 的顺序更新并 commit。无有效 target/active 时原错误路径及事务 rollback 行为保留。
- 既有 Processor PostgreSQL cases 覆盖 queue 去重、并发 worker 只发布一个 generation、capability disable 时保留 pending、完整 rebuild 与事实发布、rollback 只接受 retired target。复核后发现原清单遗漏了 generation transaction 在写入部分事实后失败的直接回滚断言，因此新增 `failed_generation_rebuild_rolls_back_partial_facts_and_preserves_active_generation`：用仅影响该测试站点的 `visitor_event_facts` CHECK constraint 使 rebuild 在写入 normalized context 后失败；移除 constraint 后断言 rebuild 报错、旧 generation 仍 active、failed generation 单独记录且其 normalized context、visitor/session/dimension facts、daily rollups 和 generation watermarks 均无残留。
- 验证：此前 `cargo test -p processor --lib`（8 passed）、Processor PostgreSQL suite（16 passed）及 canonical fixtures（1 passed）均在隔离 E2E PostgreSQL 上通过。本次修改后 lib suite 仍为 8 passed；PostgreSQL test target 编译通过，但执行 ignored suite 时本环境没有设置 `DATABASE_URL`，17 个 cases 均未运行，因此新增回滚 case 尚待迁移数据库验证。此前尝试 `pnpm test:integration` 未能启动脚本，pnpm 报 `unable to open database file`；完整跨 crate integration script 未验证。未运行整仓检查或 `pnpm e2e:analytics`，留待 5.6。
- `cargo fmt` 已应用于 Rust 改动；最终还需执行格式检查和 `git diff --check`。

## 工作包 5.4 Explicit rebuild 与 definitions 生命周期拆分（2026-10-07）

- `services/processor/src/explicit_rebuilds.rs` 现在承载 conversion/funnel rebuild（含 explicit backfill mode）、custom event rebuild、Geo country rebuild、Web Vitals rebuild，以及读取指定 definitions version 后调用 conversion/funnel rebuild 的编排。每个 rebuild 仍在原方法位置读取 capability、开启 transaction、调用 `lock_site`，并按原 SQL 顺序清理/写入事实与推进或清除 watermark；custom event rebuild 仍先提交 custom event facts，再在文件 definitions 模式下另行 rebuild conversion/funnel facts。
- `services/processor/src/definition_revisions.rs` 承载 definitions import-if-empty 及按 `received_at` 读取有效 revision。Import 仍逐 site 开启 transaction、取 advisory lock、检查 revision 是否已存在，再写 revision 和 audit 后 commit；已有 revision 仍显式 rollback 并跳过。Revision 读取仍按 `(effective_at IS NULL OR effective_at <= received_at)`、`effective_at DESC NULLS LAST, revision DESC` 选择一条，解析并验证 document。`event_processing.rs` 通过该 helper 读取 definitions；事务 owner 和调用顺序不变。
- 静态逐项复核结果：conversion/funnel 的 capability early return、按版本删除与 `enabled_since` 限定删除、按 occurred/event ID 顺序遍历 processed custom events、active generation session lookup、fact 写入及 definition watermark 推进均保持原顺序；explicit backfill 仍只重建当前 definition version，非 explicit 模式仍受 activation 时间限制。Custom event rebuild 的 watermark 推进与 conversion/funnel watermark 清除保持同一事务；Geo/Web Vitals rebuild 的清理、插入/upsert、水位推进和 commit 顺序不变。版本指定 rebuild 仍先从 revision 表读取指定版本，验证 definitions，再以文件 definitions 模式调用既有 rebuild。原有 PostgreSQL 用例覆盖 definitions import 幂等、received-at revision 选择及 Geo rebuild，但不直接覆盖 custom event、conversion/funnel 或 Web Vitals explicit rebuild；现已在 `imports_definitions_once_and_processes_events_by_received_at_revision` 中增加 custom event facts rebuild、指定版本 conversion/funnel rebuild（含两步 funnel）断言，并新增 `rebuilds_web_vital_facts_and_advances_its_watermark` 覆盖最高 report sequence 与 watermark。
- 未修改 schema、migration、CLI、Processor crate 公共导出或 PostgreSQL 测试文件结构；`Processor` public 方法签名保持不变。
- 验证：`cargo fmt -- --check` 通过；`cargo test -p processor --lib` 为 8 passed；更新后 `cargo test -p processor --test processor --no-run` 编译 18 项 PostgreSQL cases 成功。此前尝试 `cargo test -p processor --test processor -- --ignored --test-threads=1` 时 17 项均因未设置 `DATABASE_URL` 在测试初始化时报错；新增用例也尚未在数据库上运行，不能视为数据库行为通过。`pnpm test:integration` 由 `tooling/ci/test-integration.sh` 明确因缺少 `DATABASE_URL` 提前退出。`git diff --check` 通过；隔离 PostgreSQL 行为仍待 5.6 验收。

## 工作包 5.5 Processor PostgreSQL 测试按行为域重组（2026-10-07）

- `tests/processor.rs` 保留 integration target 入口和模块声明；18 个 PostgreSQL 用例分别位于 `tests/processor/event_processing.rs`、`explicit_rebuilds.rs`、`generation_rebuild.rs`。共享数据库 setup、capability/site seed、raw event helper 与 cleanup 收拢在 `tests/processor/support.rs`。
- 18 个 PostgreSQL 用例全部保留 `#[ignore]`，由 `--ignored --test-threads=1` 串行启用；target 名 `processor` 未变。`tests/canonical_fixtures.rs` 仍是独立的 `canonical_fixtures` target。integration 脚本仍在 Collector suites 后串行运行 processor 与 canonical fixtures。
- 行为映射包括 Page View 幂等、UTC 日界和跨 Site 隔离、capability pause/resume、received-at definitions revision 与 import 幂等、Geo/Web Vitals/custom event/conversion/funnel rebuild、late event/backfill、queue 去重与并发 worker、失败 rollback、完整 generation rebuild 和 rollback。

## 工作包 5.6 整体验收与关闭（2026-10-07）

- 静态复核：`lib.rs` crate 导出未改变（仅新增内部 `mod` 声明）；`Processor` 原有公共方法签名保持不变。新增实现模块以同 crate 的 `impl Processor` 承担职责，纯 parser/normalizer/sessionizer 继续独立；事务 owner、advisory/generation row locks、definitions revision 选择、queue transitions、watermark 和错误回滚顺序与 5.1 inventory 对照一致。未发现 schema、migration、CLI、API 或统计语义变更。测试入口与 ignored 串行方式保持不变。
- 定向检查：`cargo test -p processor --lib`：8 passed；`cargo test -p processor --test processor --no-run` 和 `cargo test -p processor --test canonical_fixtures --no-run` 均通过；`cargo fmt --all -- --check`、`git diff --check` 通过。
- Workspace 验收：`pnpm check`、`pnpm test`、`pnpm build` 均通过。Check 有 5 条 generated protocol 文件的 unused-disable warnings、0 errors。`pnpm e2e:analytics` 通过全部 10 个 analytics workflow fixtures，并清理 runner 创建的隔离 Compose 环境。
- PostgreSQL integration：在 E2E runner 管理的独立、迁移后 PostgreSQL 上，Collector suite 7 + 1 + 1 项通过，Processor suite 18 项通过，canonical fixtures 1 项通过，Analytics API suite 15 项通过，共 43 项通过。首次未设置 `DATABASE_URL` 的 `pnpm test:integration` 调用按脚本要求提前退出；随后通过隔离 E2E runner 创建数据库，并在获批后重跑 `pnpm test:integration`，包装命令及全部 migration / cargo suites 均成功。未连接本地开发数据库。
- 环境和覆盖限制：sandbox 内到隔离 Compose PostgreSQL 的 localhost 连接被拒绝；按权限流程获批后完整 integration 通过。没有额外覆盖 Tokio cancellation/shutdown 时序；此行为不属于本次职责搬移，事务/锁和完整可见性已有静态复核及上述 PostgreSQL suite 验证。
- 后续模块边界整理：review 发现事实/重建模块依赖 `processor::lock_site`。现将保持同一 SQL、参数及调用时机的 advisory-lock helper 移至 `queries::lock_site`；锁定仍由调用方持有的同一事务执行。`cargo check -p processor`、`cargo fmt --all -- --check` 与 `git diff --check` 通过；该移动不改变 SQL 或事务所有权。
- 结论：5.1–5.6 必需实现与验收完成，工作包 5 关闭。

### 建议模块树与边界

目标依赖方向：纯输入阶段 → 纯会话/定义逻辑 → event/rebuild 专用实现 → Processor public orchestration → `queries` / PgPool I/O。建议从下列职责切分，最终模块名以 5.1 上述逐函数/事务复核后确认为准：

```text
processor.rs             Processor 类型、公共入口及薄编排
event_processing.rs       process_one / process_all_once 与单事件事务编排
event_facts.rs            单事件 facts、dimensions、context 与 watermark 写入
explicit_rebuilds.rs      conversion/funnel、custom event、Geo、Web Vitals 显式 rebuild
generation_rebuild.rs    RebuildRequest、队列、generation build/activation/rollback
definitions.rs            保留现有纯 definition model/validation；DB revision 操作按需单独模块
queries.rs                保留 DB 查询/标记 helper，不反向依赖 Processor
```

以上是职责草图，不要求为每个 helper 建文件。若逐函数追踪显示某组跨越共享事务，需把事务协调留在同一个 orchestration 边界，并让下层接受显式 `&mut Transaction`；不为了减小文件拆开 transaction owner。

### 最终验收

- 子切片先跑 `cargo test -p processor --lib` 与对应 DB tests；完整验收通过 `pnpm test:integration`，不能用普通 `pnpm test` 中的 ignored DB cases 替代。
- workspace 用 `pnpm check`、`pnpm test` 和 `pnpm build` 验证；CI 同款脚本负责 fmt、Clippy、Rust workspace tests/build 与 package checks。
- 运行 `pnpm e2e:analytics` 验证 Processor 到 Analytics API/Dashboard 查询的实际 workflow。Compose/DB/Chromium 不可用时记录具体阻碍和替代证据，不计通过。
- 关闭前复核 crate exports、错误行为、SQL transaction boundaries、测试 target 名称、串行执行、fixtures 以及无 schema/API 变动；保留任何不能在本切片覆盖的历史运行时限制。
