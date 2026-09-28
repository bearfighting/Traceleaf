# Phase 6 Design — Browser Identity, Sessionization and Analytics Dimensions

> Historical implementation design: this document describes the temporary Phase 6 V1/V2 rollout and site-level feature flags. It is retained for implementation history; after Phase 7 PR0, the unified protocol and capability-oriented configuration documents take precedence.

> Status: Completed historical implementation design; superseded by Protocol Consolidation before public release
> Scope: Browser Visitor ID、Protocol V2 production enablement、Sessionization、Browser Context normalization、Dimensions、Analytics API 和 Dashboard

## 1. Phase 6 定义

Phase 6 在 Phase 5 已冻结的语义和契约之上，完成 Browser Context、Visitor、
Session 和 Dimensions workflow。下方 V1/V2 表述仅保留为实现历史；当前 runtime
使用 Phase 7 PR0 合并后的唯一初始协议：

```text
Browser SDK
  → Unified Protocol Visitor ID / Browser Context
  → Collector unified ingestion
  → PostgreSQL Raw Events
  → Context Normalizer / User-Agent Parser
  → Session Rebuilder
  → Visitor / Session / Dimension Aggregates
  → Analytics API
  → Dashboard
```

Phase 6 的实现必须保持 Phase 3/4 Page View workflow 可独立运行。Visitor、Session 和 Dimension 都是 Raw Event 之上的可重建派生结果，不把任何客户端身份或不可逆计数器作为事实源。

## 2. 必须达成

- Browser SDK 在获得 consent 后，为每个站点生成并复用匿名 UUID v4 Visitor ID。
- Collector 可以在 feature flag 开启后接收 Protocol V2，同时继续兼容 Protocol V1。
- V1/V2 事件都继续产生 Page View；没有 Visitor ID 的事件不产生 Visitor/Session 指标。
- Browser Context 按 `protocol/contexts/v1/` contract 规范化，非法字段不会导致整条事件失败。
- User-Agent 派生值带 parser version，原始 User-Agent 不进入 API 或 Dashboard。
- Processor 可以按 `occurred_at`、UTC 午夜和 30 分钟规则重建 Session。
- 24 小时 lateness window 内的迟到事件可以自动重建；窗口外事件通过显式 backfill/rebuild 处理。
- Visitor、Session 和 Dimension 聚合支持 generation 切换、共同 freshness watermark 和 rollback。
- 新 Analytics API 与 Dashboard 能展示 Visitor、Session 和第一批 Dimensions。
- 完成 PostgreSQL、浏览器和 API/Dashboard E2E 验证。

本设计中的实现级约束优先于仅用于说明的字段列表。凡是涉及 distinct、generation、watermark、rebuild 或 feature flag 的实现，都必须遵循第 6.5、7.3、8.4 和 10.1 节的定义。

## 3. 不属于本阶段

- 登录用户、跨设备合并或第三方广告 ID。
- IP 持久化、精确地理位置、指纹识别和国家推断。
- Client-side `session_id`、客户端 Session 统计或客户端聚合。
- 低延迟 websocket、复杂跨实例一致性或跨区域部署。
- 站点时区报表；Phase 6 继续使用 UTC calendar date。
- 自定义事件、Conversion、Funnel、Replay、Heatmap 和 A/B Testing。
- 对历史 Page View API contract 的 breaking change。

## 4. 实施原则

### 4.1 Contract first

Phase 5 的 Protocol V2、Browser Context、Session 和 API contract 是实现输入。任何 contract 变化必须先更新 schema、fixture、ADR 和跨语言验证，再修改生产代码。

### 4.2 Raw Event immutable

Collector 保存原始 payload 和接收元数据。Normalizer、Parser、Sessionizer 和 Aggregator 只能创建或替换派生 generation，不原地改写 Raw Event。

```text
raw_events
  ├── page_view_daily / page_view_routes / page_view_totals
  ├── normalized_event_context
  ├── session_events / sessions
  ├── visitor_daily / session_daily
  └── dimension_daily
```

### 4.3 V1 compatibility first

V1 继续是合法的 Page View 输入。V2 rollout 只能增加可选身份和 Context 能力，不能要求旧事件补发 Visitor ID，也不能把缺失身份解释为共享 anonymous Visitor。

### 4.4 Rebuild before optimization

先实现从 Raw Event 重建指定 site、Visitor、日期范围和 parser generation 的路径，再实现增量处理。增量路径的结果必须能与重建结果逐项比较。

## 5. Browser SDK and Protocol V2

### 5.1 Visitor ID 生成和存储

SDK 行为固定为：

1. 检查 analytics consent；没有 consent 或已 opt out 时不生成、不读取、不发送 Visitor ID。
2. 在被观测网站的 first-party `localStorage` 查找站点命名空间中的 Visitor ID。
3. 如果值缺失、格式非法或存储不可用，在 consent 允许时使用 `crypto.randomUUID()` 生成 UUID v4；无法生成或持久化时发送没有 Visitor ID 的 Page View，不使用 fallback。
4. 写入前和发送前都校验小写 canonical UUID v4 格式。
5. consent 撤回后停止发送，并在可访问时删除本 origin 的 Visitor ID。

Storage key 使用站点命名空间，例如 `web-analytics:visitor:<site_id>`。Phase 6 不跨 origin、跨子域或通过 Cookie 共享 ID；一个 `site_id` 只绑定一个 origin。

Visitor ID 不放入 URL、referrer、非 analytics 请求或客户端 `session_id`。

### 5.2 Browser Context 采集

SDK 只采集 Phase 5 Browser Context V1 定义的字段。采集失败或非法值交给 normalizer 映射为 `unknown`；UTM 空值不产生维度；未知字段不进入 normalized context。

SDK 不采集：IP、精确地理位置、Canvas/字体指纹、硬件并发数、session_id 或跨设备标识。

### 5.3 Collector rollout

V2 production enablement 采用按 site 配置的 feature flag：

```text
PHASE6_PROTOCOL_V2_ENABLED=false
PHASE6_ANALYTICS_ENABLED=false
```

PR1 起，Collector 的 Protocol V2 运行时 flag 以 PostgreSQL
`analytics_feature_flags.protocol_v2_enabled` 为准；不存在的 site row 等同于关闭。
上面的环境变量只表示部署默认值/总开关，不复制 Collector TOML site 列表，也不替代
site-level 数据库配置。V1 请求不读取该表；V2 flag 关闭时返回统一的
`invalid_event_batch`，不会自动降级为 V1。

- flag 关闭时保持当前 V1 Collector 行为。
- flag 开启后允许合法 V1 和 V2 Page View 混合接收。
- V2 envelope、Visitor ID 和 context schema 在 Collector 层校验结构；字段级 unknown/非法 Context 值由 normalizer 处理，不拒绝整条事件。
- 超过 5 分钟的未来 `occurred_at` 拒绝为 `invalid_occurred_at`；V1 已有接收行为不因 Phase 6 rollout 被隐式改变。
- `site_id + event_id` 幂等规则保持不变。
- 关闭 flag 不删除已经写入的 V2 Raw Event；可以回滚新 Processor/API，但 Raw Event 保留。

## 6. Storage and Migration Contract

所有 migration 都是 additive。首次部署先创建派生表和 metadata，不切换 API；完成 backfill 和对账后再启用 Phase 6 feature flag。

### 6.1 Raw Event metadata

在 `raw_events` 增加可空字段，不改变既有 Page View 字段：

```text
visitor_id              uuid null
context_schema_version  integer null
```

保留完整 `payload`，不把 normalized Context 或 parser 结果写回原始 payload。索引至少包括 `(site_id, visitor_id, occurred_at)` 和 `(site_id, received_at)`；现有幂等约束和 Page View 索引继续保留。

### 6.2 Normalized Context

`normalized_event_context` 按 generation 保存；同一个 Raw Event 可以在不同 parser generation 中拥有不同的派生结果：

```text
generation_id      uuid not null references analytics_generations(generation_id)
raw_event_id       bigint not null references raw_events(id)
site_id            varchar(64) not null
context_version    integer not null
parser_version     varchar(64) not null
language           text not null
timezone           text not null
viewport_width     integer or unknown representation
viewport_height    integer or unknown representation
screen_width       integer or unknown representation
screen_height      integer or unknown representation
utm_*              nullable text
referrer_host      text not null
device             text not null
browser             text not null
os                  text not null
normalized_at      timestamptz not null
```

主键为 `(generation_id, raw_event_id)`。尺寸字段使用 nullable integer 表示 `unknown`；原始 User-Agent 不写入该表，只从 Raw Event payload 受限读取并转换为 `device`、`browser` 和 `os`。

Raw User-Agent 只保留在受限的 Raw Event payload/存储边界中，不从该表或 API 返回。normalized context 的唯一输入是允许的 Browser Context。

### 6.3 Session facts and generations

使用 generation 隔离重建结果：

```text
analytics_generations
- generation_id
- site_id
- aggregation_version
- parser_version
- processed_received_watermark
- status: building | active | retired | failed
- created_at / activated_at

session_events
- generation_id
- raw_event_id
- site_id
- visitor_id
- session_id
- occurred_at

sessions
- generation_id
- session_id
- site_id
- visitor_id
- started_at
- ended_at
- page_views
```

`session_id` 只作为服务端内部派生键，不进入客户端协议或公开 API。它在相同 `site_id + visitor_id + aggregation_version + generation input` 下确定性生成；迟到事件导致 Session 合并/拆分时，新的 generation 可以产生新的内部 Session ID，API 不承诺跨 generation 的 Session ID 稳定性。

### 6.4 Aggregates and watermarks

至少增加：

```text
visitor_daily
- generation_id, site_id, day, unique_visitors, page_views

session_daily
- generation_id, site_id, day, sessions, page_views

dimension_daily
- generation_id, site_id, day, dimension, value
- page_views, unique_visitors, sessions

dimension_event_facts
- generation_id, raw_event_id, site_id, visitor_id nullable, session_id nullable
- dimension, value, occurred_at, day
- 每个 Page View 对每个非空 Dimension/value 最多一行

analytics_watermarks
- site_id, generation_id nullable, source_name, processed_received_watermark
```

`data_as_of` 取构成本次 response 的所有 source watermark 的最小值。没有匹配输入时为 `null`。API 只能读取 active generation，并且不能把较新的 Page View watermark 与较旧的 Visitor/Session generation 假装成同一 freshness。

所有派生表必须有 generation 或等价的 rebuild scope，避免 rebuild 中间结果被 API 读取。切换 active generation 使用事务或等价原子更新。

### 6.5 Generation、事实表和数据库约束

`generation_id` 是全局唯一的 UUID；同一 site 同时最多只能有一个 `active` generation。建议使用数据库约束或等价事务保证：

```text
UNIQUE (generation_id)
UNIQUE active generation WHERE site_id = ? AND status = 'active'
```

Generation 必须记录完整输入边界：`site_id`、`aggregation_version`、`parser_version`、创建时的 source watermark、rebuild scope 和创建原因（initial、incremental、backfill、reparse）。`building` generation 只能由 Processor 读取，API 只能读取 active generation。

建议的事实表约束如下：

```text
session_events
- PRIMARY KEY (generation_id, raw_event_id)
- FOREIGN KEY (generation_id, raw_event_id) → raw_events

sessions
- PRIMARY KEY (generation_id, session_id)

normalized_event_context
- PRIMARY KEY (generation_id, raw_event_id)
- FOREIGN KEY (generation_id, raw_event_id) → analytics_generations, raw_events
```

一个成功去重的 Raw Event 在同一 generation 中最多对应一个 Session Event。`session_id` 是 generation 内部标识，不对外公开；生成算法必须使用固定的字节编码和 hash/UUID 规则，并在 Processor 的跨语言 fixture 中验证。不同 generation 可以为同一 Raw Event 产生不同的 `session_id`。

Generation 激活必须在单个事务中完成：锁定 site 的 active generation，确认新 generation 所有 required sources 已完成，写入新 active 状态，再将旧 generation 标记为 `retired`。Rollback 采用同样的原子切换，不删除 Raw Event 或旧 generation。

`analytics_watermarks` 必须按 `site_id + generation_id + source_name` 保存。Watermark 是 source 的连续处理水位，不是任意已处理事件的最大 `received_at`：水位之后不能存在未处理的 Raw Event。没有匹配输入时 API 返回 `data_as_of: null`；generation 为 building、failed 或 watermark 落后时，API 返回 active generation 的数据并标记 stale/rebuild 状态，不读取半成品。

## 7. Processing and Rebuild Semantics

### 7.1 Normal processing

现有 Page View 处理保持不变。`analytics_enabled` 开启后，Processor 在同一事务中为带 Visitor ID 的事件合并 `analytics_rebuild_queue`；事件本身仍先写入既有 Page View aggregate 并设置 `processed_at`。Queue worker 读取 pending incremental task，重建整个 site 的派生 generation，完成后再原子切换 active generation。这样不会把单个 Visitor 的半成品结果发布为全站 active generation。

`received_at - occurred_at <= 24h` 的事件进入自动 incremental queue；超过 24 小时的事件只进入 backfill queue，不由普通 worker 自动激活。缺少或关闭 `analytics_enabled` 时不创建新 queue，旧 Page View workflow 继续运行。

Raw Event processing 和 generation rebuild 使用相同的 site-level advisory lock，避免 rebuild 读取输入后又有事件在激活前改变 source watermark。相同 queue key 的 reason 按 `backfill > incremental` 升级；worker 会回收超过 5 分钟未更新的 running task。Generation 的 `source_watermark` JSONB 和 `analytics_watermarks` 必须保存同一个实际连续 `processed_received_watermark`。

PR3 的 generation 是完整 site generation。`--from/--to` 会写入 rebuild scope、用于 backfill queue 去重和结果审计，但当前实现仍读取完整 site 历史，以保证替换 active generation 时不丢失范围外事实；后续如需性能优化，必须通过复制旧 generation 的范围外事实并验证边界 Session 后再改为真正的范围重建。

单个事件的 Phase 6 处理分为两个事务阶段。Raw Event 处理事务保持现有 Page View 语义：

```text
claim Raw Event
  → update Page View daily/route/total
  → update affected Visitor rebuild queue when applicable
  → set processed_at
  → commit
```

随后由 queue worker 在独立的 generation rebuild transaction 中读取该 site 的完整已处理历史：

```text
lock site and rebuild queue
  → normalize Browser Context
  → write generation-scoped event/session facts
  → sessionize and write daily Visitor/Session aggregates
  → write the continuous source watermark
  → atomically activate the new generation
  → commit
```

Collector 不执行 Sessionization；Processor 负责 Context normalization 后的统计转换。事件处理失败时事务回滚，Raw Event 保留并可重试。

### 7.2 Sessionization

对同一 `site_id + visitor_id` 的去重 Page View：

1. 按 `occurred_at ASC, event_id ASC` 排序。
2. 相邻事件间隔小于 30 分钟且没有跨 UTC 午夜时保留同一 Session。
3. 间隔大于或等于 30 分钟，或跨 UTC 午夜时开始新 Session。
4. 没有 Visitor ID 的事件只进入 Page View，不进入 Session facts。
5. 多标签页只共享 Visitor ID，不按 tab、path 或 navigation type 拆分。

### 7.3 Late events and rebuild queue

- `received_at - occurred_at <= 24h` 的合法迟到事件标记受影响 Visitor、UTC 日期和相关 Dimension，自动触发 rebuild。
- 超过 24h 的事件仍写入 Raw Event，但进入显式 backfill queue，不自动修改稳定 generation。

没有 Visitor ID 的 V2 事件不创建 Visitor/Session queue，也不会触发自动 generation rebuild；它们不会进入当前 active generation 的派生事实，直到下一次 site-wide initial/backfill/reparse rebuild。发生 rebuild 时，合法的 V2 Context 仍会写入 generation-scoped `normalized_event_context`，但不会写入 Visitor、Session 或对应 daily facts。这样可以保持“没有 Visitor ID 不创建 Visitor/Session”的约定，同时避免为无法参与 Sessionization 的事件频繁触发全站 rebuild。

Queue worker 遇到失败任务后不会自动重试 `failed` row。需要通过相同的 site、scope、aggregation version 和 parser version 重新 enqueue，创建新的 pending task；超过 5 分钟未更新的 `running` task 才会被 worker 自动回收。并发 worker 对同一 task 最终只允许一个 active generation，重复 worker 不会创建额外 failed generation。

- 未来事件最多领先 5 分钟；超过则拒绝。
- rebuild 以 `site_id + visitor_id + aggregation_version + date scope` 去重，重复请求合并。
- 同一 site 的 generation rebuild 串行切换；不同 site 可以并行。

arrival delay 的判定统一使用 Collector 写入 Raw Event 时生成的 `received_at` 和事件的 `occurred_at`：

```text
delay = received_at - occurred_at

delay < 0              → future event；仅当 occurred_at - received_at <= 5m 时接受
0 <= delay <= 24h      → late event，可自动触发 rebuild
delay > 24h            → accepted late event，进入显式 backfill queue
occurred_at - received_at > 5m → rejected as invalid_occurred_at
```

边界值包含在允许范围内。Collector 的数据库/服务端时间是 `received_at` 的唯一来源；测试 fixture 可以显式注入固定的 received time。未来事件不会进入 late-event queue。

当前 generation rebuild 使用完整 site snapshot：即使命令带有 `--from/--to`，也会读取该 site 的全部已处理 Raw Event，再整体生成并原子激活新 generation。这样可以保证 generation-scoped Session ID、Visitor facts、Dimension facts 和 daily aggregates 在 active generation 中保持完整。`--from/--to` 仍用于 queue 去重、generation scope metadata、dry-run 和结果审计。

未来若要实现真正的范围重建，必须先实现旧 generation 范围外事实复制，并验证跨日期 Session 边界；不能只写入请求范围后直接激活，否则会发布不完整 generation。

命令接口固定为：

```text
processor --rebuild --site-id site_example --from 2026-09-01 --to 2026-09-18
processor --backfill --site-id site_example --from 2026-09-01 --to 2026-09-18
processor --reparse --site-id site_example --parser-version <version>
```

命令必须支持 dry-run、进度日志、失败状态和重复执行。Backfill 不覆盖 Raw Event，只创建新 generation；对账通过 Page View、Visitor、Session 和 Dimension 的 fixture 结果完成。

## 8. Aggregation Semantics

### 8.1 Page Views

Page Views 统计所有成功接收、去重后的 Page View，包括没有 Visitor ID 的事件。日期取 `occurred_at` 的 UTC calendar date。

### 8.2 Visitors and Sessions

- `unique_visitors` 是指定 site 和日期范围内的 distinct `visitor_id`，不是每日数值简单求和。
- `sessions` 是指定范围内 active generation 的 distinct internal Session，跨 UTC 午夜已经拆分。
- 每日 item 的 `unique_visitors` 和 `sessions` 只在当天去重。
- 没有 Visitor ID 的 Page View 不增加任一 Visitor/Session 指标。
- 顶层 `page_views` 是范围内 Page View 总数；顶层 Visitor/Session 数值按范围重新 distinct。

### 8.3 Dimensions

允许的 Dimension：`language`、`timezone`、五个 UTM、`referrer_host`、`device`、`browser`、`os`。

- 每个 Page View 独立参与各个非空 Dimension；不同 Dimension 不互相排斥。
- 空 UTM 不生成条目；缺失/解析失败 Referrer 为 `direct`。
- `unknown` 是合法维度值。
- Dimension 的 `page_views` 是该值的 Page View 数。
- `unique_visitors` 是该值关联的 distinct `site_id + visitor_id`；无 Visitor ID 的事件不增加该字段。
- `sessions` 是该值关联的 distinct Session；同一 Session 在同一 Dimension/value 中只计一次。
- Dimension items 按 `page_views DESC, value ASC` 排序，默认 20、最大 100，不分页。

### 8.4 Range distinct 的事实来源

`visitor_daily`、`session_daily` 和 `dimension_daily` 只用于每日结果，不能用于跨日期范围的 distinct 求和。Visitors、Sessions 和 Dimensions API 的范围级数值必须从可去重的事件级事实查询，或从等价的 distinct bridge 查询。

Phase 6 使用以下事件级事实作为规范来源：

```text
visitor_event_facts
- generation_id, raw_event_id, site_id, visitor_id, occurred_at, day

dimension_event_facts
- generation_id, raw_event_id, site_id, visitor_id, session_id
- dimension, value, occurred_at, day
```

`visitor_event_facts` 只包含有 Visitor ID 的去重 Page View；`dimension_event_facts` 每个 Page View 对每个非空 Dimension/value 最多一行。API 范围查询分别对 `(site_id, visitor_id)` 和 `(site_id, visitor_id, session_id)` 做 distinct。没有 Visitor ID 的事件仍可以进入 Page View aggregate，但不进入上述事实表的 Visitor/Session 字段。

事件级事实表必须建立 `(site_id, generation_id, occurred_at)`、`(site_id, generation_id, visitor_id, occurred_at)` 和 dimension/value 查询所需的复合索引。若实现选择直接从 `session_events` 和 `normalized_event_context` 查询，必须提供等价的唯一性约束、索引和 integration test；不能从每日 counter 推导范围级 distinct。

## 9. User-Agent Parser Contract

Phase 6 PR1 必须先新增 ADR 选择具体 parser 库、版本和升级策略。在该 ADR 合并前，不能将 parser 结果作为稳定生产指标。

PR1 已通过 [ADR-006](../../decisions/ADR-006-user-agent-parser.md) 锁定 Rust `woothee` crate `0.13.0`，生产 parser version 为 `woothee-0.13.0`。PR1 只锁定决策和 migration metadata，不实现正式 Parser adapter；adapter 在 PR3 实现。

实现必须提供以下接口边界：

```text
parse(user_agent, parser_version)
  → device, browser_family, browser_major, os_family, os_major
```

Browser、OS 的公开 value 使用固定格式：`family` 或 `family:major`；Device 只允许 `desktop`、`mobile`、`tablet`、`unknown`。无法稳定提取 major version 时使用 family，不猜测版本。Parser adapter 必须隐藏具体第三方库，使 parser 升级只影响 adapter 和 generation 输入。

要求：

- 无法识别时返回 `unknown`，不猜测。
- 原始 User-Agent 不进入 API、Dashboard 或结构化日志。
- parser_version 写入 normalized context 和派生聚合。
- 新版本先 shadow parse/rebuild，与 active generation 对账。
- 通过校验后创建新 generation 并原子切换。
- 回滚只切回旧 generation，不修改 Raw Event。

## 10. Analytics API Contract

Phase 6 启用 Phase 5 OpenAPI 中标记为 `draft-not-enabled` 的路径：

```text
GET /v1/sites/{site_id}/reports/{from}/{to}/visitors
GET /v1/sites/{site_id}/reports/{from}/{to}/sessions
GET /v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}?limit=20
```

API 实现规则：

- 保持现有 site/date/limit validation 和 UTC 闭区间。
- Visitors/Sessions 顶层值按整个范围 distinct，daily items 按日期升序。
- Dimensions 按 `page_views DESC, value ASC` 返回。
- `data_as_of` 使用共同最小 watermark；没有匹配输入时为 `null`。
- Phase 6 response 增加 `freshness_status`：`current`、`stale`、`rebuilding` 或 `failed`。状态由 active generation、legacy Page View watermark、rebuild queue 和最近 generation 状态共同计算。
- `aggregation_version` 是计算语义版本，不是数据库 migration 版本。
- 新 endpoint 使用 feature flag；flag 关闭时当前 API 路由、OpenAPI V1 behavior 和 Dashboard 完全不变。
- API 不返回 Visitor ID、原始 User-Agent、IP、Session ID 或逐事件轨迹。
- 数据库不可用返回现有 generic API error，不泄露 parser、SQL 或 Raw Event 内容。

实现阶段把 OpenAPI 中 Phase 5 的新增路径更新为 `x-phase: 6` 和 `x-lifecycle: enabled-behind-feature-flag`；feature flag 关闭时不注册或返回统一的 not-enabled 错误，不能改变既有 Page View 路由。

API response 的范围级 `unique_visitors`、`sessions` 和 Dimension item 指标必须遵循第 8.4 节的事件级 distinct 规则。`data_as_of` 取本次响应实际使用的所有 source/generation watermark 的最小值；不能使用当前时间、请求 `to` 日期或某个较新的 Page View watermark 代替。

### 10.1 Feature flag、consent 和 Browser SDK runtime contract

Phase 6 feature flag 的逻辑作用域是 `site_id`，环境变量只用于设置默认值或关闭整个能力。生产配置必须能够表达：

```text
site_id
protocol_v2_enabled
analytics_enabled
updated_at
```

`protocol_v2_enabled=false` 时，Collector 保持既有 V1 行为；V2 不得静默降级为 V1，也不得写入未经 V2 校验的 Visitor/Context 字段。`analytics_enabled=false` 时，Processor 可以继续处理 Page Views，但不激活新的 generation/API。API、Processor 和 Dashboard 的 site flag 不一致时，API 只能读取已 active 且允许公开的 generation。

Browser SDK 的 consent 状态必须由调用方显式提供，默认状态为 denied。denied 或 opt-out 时不读取、不生成、不发送 Visitor ID，也不发送 Analytics Event；不得把事件缓存到 consent 恢复后再发送。consent 从 denied 变为 granted 后，SDK 才能读取或创建 localStorage ID。存储失败时，在 granted 状态下仍可发送没有 Visitor ID 的 Page View；不得使用临时 ID、Cookie、User-Agent 或 fingerprint fallback。撤回 consent 时停止后续发送，并尽可能删除当前 origin 的 key 和待发送队列。

Visitor key 必须由 `site_id` 命名空间和固定前缀组成。跨 tab 的首次写入以 localStorage 中最终成功写入的值为准；每次发送前重新读取并校验 canonical UUID v4。不同 origin 或不同 `site_id` 不能共享 key。SDK 必须覆盖 storage denied、跨 tab、reload、consent revoke、UUID 生成失败和无 Visitor ID fallback 测试。

## 11. Dashboard Contract

Phase 6 Dashboard 只通过 Analytics API 查询：

- Overview 增加 unique visitors 和 sessions。
- Reports 增加 Visitor/Session daily trend。
- Dimension selector 查询第一批 allowlist Dimension。
- 显示日期范围、`data_as_of` 和 stale/rebuild 状态。
- `items=[]` 显示 empty state；`data_as_of=null` 不显示伪造时间。
- 不在浏览器端重新聚合、不读取 Visitor ID、不访问数据库。

Dashboard rollout 与 API feature flag 同步。旧 Page View 页面在新聚合未 active 时继续可用。

## 12. Privacy and Lifecycle

- 不新增 IP、精确 Geo 或指纹字段。
- Raw User-Agent 仅在明确受限的 Raw Event 存储边界内保留，必须有 retention 配置和访问控制。
- consent 撤回停止后续采集并尽可能删除 localStorage Visitor ID；历史匿名聚合不反向识别用户。
- 任何删除/retention job 必须同时重建受影响的 Page View、Visitor、Session 和 Dimension aggregates。
- API、日志和错误响应不得输出原始 URL query、User-Agent、Visitor ID 或 Raw payload。

## 13. Rollout, Monitoring and Rollback

上线顺序固定为：

1. 运行 additive migration。
2. 部署 V2-compatible Collector，保持 flags 关闭。
3. 对历史 Raw Event 创建初始 normalized context 和 generation。
4. 对账 Page View、Visitor、Session、Dimension canonical fixtures。
5. 对单个 site 开启 Processor/API feature flag。
6. 观察 watermark lag、rebuild queue、generation failure、dimension cardinality 和 API error rate。
7. 逐步扩大 site 范围。

Rollback 顺序：

1. 关闭新 API 和 Processor feature flag。
2. 将 active generation 指回上一版本。
3. 保留 Raw Event、旧 Page View aggregates 和旧 API。
4. 暂停未完成 rebuild，记录失败 generation。
5. 修复后从 Raw Event 重新创建 generation，不手工修改聚合 counter。

必须监控：

- V1/V2 ingestion count 和 reject reason；
- Processor backlog、watermark lag、迟到/未来事件数量；
- rebuild duration、失败数和 active generation；
- parser unknown rate 和 dimension cardinality；
- API 5xx、empty response、data freshness；
- Dashboard API latency 和 stale state。

## 14. PR 拆分

### PR1 — Migration and Parser Decision

- 新增 parser ADR，锁定 `woothee 0.13.0`、parser version 和分类结果。
- 实现 additive migration、watermark/generation metadata 和回滚开关。
- 不启用新 API，不切换 Dashboard。

### PR2 — Browser Visitor ID and Protocol V2

- 实现 consent-aware localStorage Visitor ID。
- Collector 接收 V1/V2，保持幂等和 V1 Page View 行为。
- 增加 Browser Context production payload 和跨层 fixture。
- 完成浏览器存储失败、跨 tab、撤回 consent 和 V1 fallback 测试。

### PR3 — Normalization, Sessionization and Rebuild

- 实现 Context normalizer、parser adapter 和 normalized context 表。
- 实现 Session facts、generation、rebuild queue、backfill/reparse 命令。
- 实现 Visitor/Session/Daily aggregate，并与 canonical fixtures 对账。
- 完成 duplicate、out-of-order、late、midnight 和 rollback 集成测试。

### PR4 — Dimension Aggregates and Analytics API

- 实现 Referrer/UTM/Language/Timezone/Device/Browser/OS aggregates。
- 启用 Visitors、Sessions、Dimensions API。
- 验证共同 watermark、range distinct、limit、排序和 empty response。
- `analytics_enabled` 关闭或缺少时，新 API 返回统一 404 `analytics_not_enabled`；既有 Page View API 不读取该 flag。
- Page View 使用 `generation_id = NULL` 的 legacy `page_views` watermark；Visitor/Session 使用 `visitor_session`，Dimension 使用 `dimensions` generation watermark。
- API 只读取 active generation，并在单次 repeatable-read transaction 中计算 response 和 `data_as_of`。
- Dashboard 保留旧 Page View 区块；Phase 6 flag 关闭时 Visitors、Sessions 和 Dimensions 区块显示 disabled state。
- Dashboard 展示 `data_as_of` 和 `freshness_status`，rebuilding/failed 时继续显示最后一个 active generation。

### PR5 — Dashboard and End-to-end Rollout

- Dashboard 展示 Visitor、Session、Dimension 和 freshness 状态。
- 完成 Browser → Collector → PostgreSQL → Processor → API → Dashboard E2E。
- 完成 feature flag rollout、rollback 和 backfill E2E。
- Dashboard 默认 Dimension 为 `browser`，通过 query parameter 支持全部 Phase 6 allowlist Dimension。
- 现有 Dashboard E2E 扩展为 V1 regression、V2 generation、disabled flag 和 Dimension 数据场景；freshness 状态由 API integration 与 Dashboard component tests 覆盖。

## 15. 测试与验收

### Contract tests

- Protocol V1/V2 schema、TS type 和 Rust validator 读取同一 fixture。
- V1 Page View、幂等、UTC 日期和现有 API contract 不变。
- Visitor ID UUID v4、site scope、consent 和 no-fallback 行为。
- Browser Context unknown、长度、范围、UTM/referrer 和 privacy boundary。

### Processor tests

- 小于、等于、大于 30 分钟边界。
- UTC 午夜拆分、多 tab 和相同时间 event_id tie-break。
- 重复、乱序、24 小时内迟到、超过窗口 backfill。
- Session merge/split、generation switch 和重复 rebuild。
- range distinct 不等于每日计数简单求和。
- range distinct 从事件级事实得到，不能从 daily counter 推导。
- rebuild 范围前后 30 分钟或完整 Visitor 历史的边界结果一致。
- generation 同一 site 单 active、原子切换和 rollback 不暴露半成品。

### API/Dashboard tests

- response schema、排序、limit、空结果、共同 watermark 和 aggregation_version。
- 未启用 flag 时新 API 不可用且旧 API 行为不变。
- site-level flag、默认 denied consent、撤回 consent 和 storage failure 行为。
- 不返回 Visitor ID、原始 User-Agent、IP、Session ID 或 Raw payload。
- Dashboard loading、empty、error、stale、rebuild 和 rollback 状态。

### Exit validation

```text
pnpm protocol:validate
pnpm protocol:v2:validate
pnpm analytics:contract:validate
pnpm test
pnpm check
pnpm format:check
pnpm test:integration
pnpm e2e:analytics
pnpm e2e:dashboard
git diff --check
```

Phase 6 完成前必须在 PostgreSQL 和浏览器环境中验证：

- V1/V2 混合接收和 Page View 向后兼容；
- Visitor、Session、Dimension 与 canonical fixtures 一致；
- 迟到事件自动 rebuild 和显式 backfill 一致；
- parser generation 可以切换和 rollback；
- API watermark 与实际处理水位一致；
- Dashboard 不绕过 API；
- 关闭 Phase 6 flags 后 Phase 3/4 workflow 仍通过。

## 16. Phase 6 退出条件

- Parser ADR、migration 和 rollout flags 已评审并锁定。
- V1/V2 混合接收、Visitor ID 和 consent 行为已通过浏览器测试。
- Raw Event 到 normalized context、Session facts 和 aggregates 可重复重建。
- Session、Visitor、Dimension range semantics 和 freshness 已通过 API contract tests。
- 迟到、backfill、generation switch 和 rollback 已通过 PostgreSQL integration tests。
- 新 API 和 Dashboard 已通过完整 E2E。
- 关闭 Phase 6 feature flags 后现有 Page View API、Processor 和 Dashboard workflow 不变。

Phase 6 完成后进入 Phase 7 MVP Feature Completion；完整测试、部署和发布验证见 Release Readiness 设计。
