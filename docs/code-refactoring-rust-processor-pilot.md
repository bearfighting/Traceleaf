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

| 行为域 | 已有覆盖 |
| --- | --- |
| Generation build / activation / rollback | rollback 只选择退役目标；generation rebuild 不修改 raw payload；daily facts 与 generation facts 的发布 |
| Capability gate / rebuild queue | disabled features 保持 page-view 流程；disabled capability 暂停待处理 rebuild；相同 site/scope 去重；并发 worker 不发布重复 generation；恢复后按规则运行 |
| Watermark / lateness / isolation | 超过 24 小时的迟到事件等显式 backfill；UTC 日期及 site 隔离；失败聚合不标记 raw event processed |
| 普通处理与事实重建 | daily routes/totals 原子更新；一次性 CLI 处理 backlog；Geo facts 从已保存 enrichment 重建；disabled custom event 只标记输入已处理而不写 facts |
| Definitions | 按 received_at/definition revision 处理；definitions import-if-empty 及显式 CLI import 幂等 |

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

- Static test review 需找出对原子可见性、并发 workers、late event、capability race、失败重试和 rollback 的直接断言；如缺口影响本次搬移保护，先加最小行为测试再拆分。

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
