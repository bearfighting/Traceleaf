# Protocol Consolidation Refactoring Plan

> Status: Completed in Phase 7 PR0

## 1. 背景和目标

当前项目仍处于开发阶段，没有真实用户、已发布 SDK 或需要长期兼容的外部客户端。Phase 5/6 期间为了分别设计和实现 V1、V2，暂时保留了两套 Event Protocol、两套 schema validator、两套 fixture 目录和多条运行时分支。

这套拆分适合验证迁移策略，但不适合作为项目首次上线时的长期结构。正式发布前应进行一次 Protocol Consolidation，将已经确认的 Visitor ID、Browser Context 和 Page View 语义合并为一份初始正式协议。

本次 refactoring 的目标是：

- 形成一份唯一的初始 Event Protocol；
- 保留 Visitor ID、Browser Context 和隐私边界；
- 移除尚未对外发布的 V1/V2 双轨兼容代码；
- 保持现有 Page View、Visitor、Session、Dimension 和 Dashboard 结果不变；
- 让未来真正的破坏性协议变更从统一的初始协议版本开始演进；
- 不把开发阶段的 Phase 编号或临时迁移路径固化为长期架构。

## 2. 实施前状态

当前仓库同时包含两种事件协议语义：

- 旧 Page View 事件：`schema_version = 1`，没有正式 Visitor ID 和 Context pairing 规则；
- Phase 6 事件：`schema_version = 2`，支持 Visitor ID、Context schema version 和 V2 校验。

实施前的实现还包含：

- Browser SDK 的 V1/V2 类型和 factory；
- Transport 对不同版本 batch 的拆分；
- Collector 根据顶层版本选择 schema；
- `protocol_v2_enabled` site-level feature flag；
- V1/V2 compatibility fixtures；
- 分开的协议验证脚本和跨语言 fixture 目录。

这些内容主要服务于开发期间的迁移验证。由于项目尚未有真实客户端，不需要把它们当成永久的公开兼容层。

## 3. 目标协议

### 3.1 唯一协议版本

统一后的正式协议使用：

```json
{
  "schema_version": 1
}
```

这里的 `1` 表示项目首次正式发布的完整协议，而不是当前历史上的旧 Page View 子集。当前 V2 的能力直接合并到这份初始协议中。

统一后的 Page View Event 保留：

- `schema_version`；
- `event_id`；
- `type = page_view`；
- `site_id`；
- `occurred_at`；
- `path`、`url`、`title`、`referrer`；
- 可选 `visitor_id`；
- 可选 `context`；
- `context_schema_version` 与 `context` 成对出现；
- 禁止客户端 `session_id`。

Visitor ID 和 Context 仍然是可选的，因此没有身份信息的事件仍然可以产生 Page View，但不会产生 Visitor 或 Session 派生事实。

### 3.2 时间语义

统一协议采用当前 Phase 6 的正式接收规则：

```text
occurred_at <= received_at + 5 minutes
```

这会统一当前 V1 和 V2 的差异。由于没有已发布客户端，这属于上线前行为收敛，不需要维护旧客户端例外路径。

### 3.3 目录结构

目标目录为：

```text
protocol/
├── events/
│   ├── schemas/
│   │   ├── event-batch.schema.json
│   │   └── page-view-event.schema.json
│   ├── examples/
│   └── fixtures/
│       ├── valid/
│       └── invalid/
├── contexts/
│   └── browser-context.schema.json
├── contracts/
│   ├── analytics-api/v1/
│   │   ├── api-contract-cases.json
│   │   └── fixtures/
│   └── http-ingestion/v1/
│       ├── config/
│       └── fixtures/
└── scenarios/
    └── analytics-semantics/v1/cases.json
```

协议 schema 的 `$id` 使用稳定语义路径，例如：

```text
https://web-analytics-platform.dev/schemas/events/page-view-event.schema.json
https://web-analytics-platform.dev/schemas/contexts/browser-context.schema.json
```

不再使用 `phase-3`、`phase-5`、`phase-6` 或 `v1/v2` 目录表达当前实现阶段。

## 4. 实施计划

### PR1 — Unified Protocol Contract

目标：先建立唯一 schema 和 canonical fixtures。

- 合并 Event V2 字段到唯一 Event schema；
- 将 `schema_version` 固定为 `1`；
- 将 Browser Context schema 合并为唯一 `contexts/browser-context.schema.json`；
- 合并 V1/V2 valid、invalid 和 compatibility fixture；
- 保留无 Visitor、完整 Context、非法 UUID、非法 Context pairing、future event 和 mixed legacy input 等覆盖；
- 删除 V1/V2 schema 之间的重复定义；
- 更新 schema `$id`、`$ref` 和所有 fixture 命名；
- 新增一份统一的 `validate-event-protocol.mjs`。

PR1 不修改数据库表结构和业务聚合逻辑。

### PR2 — SDK and Transport Consolidation

目标：让浏览器端只产生和发送一种协议。

- 合并 `PageViewEvent` / `PageViewEventV2` 类型；
- 合并 `EventBatch` / `EventBatchV2` 类型；
- 保留可选 `visitor_id` 和 `context`；
- 保留 `beforeSend`，但不再允许版本降级或版本转换；
- 删除 V1/V2 batch 拆分逻辑；
- Transport 始终发送统一 `schema_version = 1` batch；
- 更新 Browser SDK factory、MockTransport、FetchTransport 和测试；
- 更新 SDK 示例，使其直接使用统一协议。

Consent、Visitor ID storage、Context normalization 和 Parser 行为保持不变。

### PR3 — Collector Consolidation

目标：Collector 只保留一条 schema validation 和 ingestion path。

- 删除 V1/V2 双 validator 和对应 resolver 分支；
- 统一解析为一个 Rust Page View event 类型；
- 统一执行 five-minute future event validation；
- 保留 Visitor ID、Context metadata 和 Raw payload 持久化；
- 删除 mixed-version batch 判断；
- 删除 `protocol_v2_enabled` 的运行时读取和测试；
- 保留 V1/V2 fixture 中仍然有价值的语义覆盖，但改成统一协议 fixture。

`analytics_enabled` 继续保留，因为它控制 Processor、Analytics API 和 Dashboard 的 Phase 6 派生能力，不属于协议版本开关。

### PR4 — Processor, API and Database Cleanup

目标：清理仅为协议迁移存在的遗留字段和分支。

- Processor 继续读取统一 Raw Event；
- 保持 Page View、Visitor、Session、Dimension 聚合结果不变；
- 保留 `context_schema_version`，因为它描述 Context 语义版本，不是 Event Protocol 双轨版本；
- 停止使用 `protocol_v2_enabled`；
- 新增 additive migration，将 `protocol_v2_enabled` 标记为 deprecated，或在首次正式发布前删除该列；
- 不修改已执行 migration；
- 不删除 Raw Events、generation、session 或 dimension facts；
- 更新 integration fixtures、API tests 和 E2E fixtures。

如果正式发布前允许重置开发数据库，可以在 release baseline 中重新整理 migration history；否则必须通过新 migration 清理，不能修改既有 SQL。

### PR5 — Documentation and Release Baseline

- 更新 `docs/event-protocol.md`，描述统一初始协议；
- 更新 Phase 5/6 文档中的历史迁移说明，明确 V1/V2 只是开发阶段方案；
- 更新 README、roadmap、OpenAPI 和 package README；
- 删除 `protocol:phase5:validate` 等阶段命名入口；
- 统一为 `protocol:validate` 和 `analytics:contract:validate`；
- 增加 pre-release migration/reset 操作说明；
- 创建一份 release baseline checklist，确认不存在 Phase-specific protocol path。

## 5. 兼容和数据处理

本次是上线前 consolidation，不是对外发布后的兼容升级。因此允许：

- 修改未发布的 Protocol schema version 语义；
- 更新现有 SDK、Collector 和 Processor 代码；
- 重新生成或重写 canonical fixtures；
- 重置开发数据库和测试数据库；
- 删除只服务于 V2 rollout 的 `protocol_v2_enabled` 代码路径。

仍然不能做：

- 修改已经执行的 SQL migration 文件；
- 删除 Raw Event 原始 payload；
- 修改 `site_id + event_id` 幂等语义；
- 修改 Session timeout、UTC midnight、late event 和 missing Visitor 语义；
- 让 Dashboard 直接访问 PostgreSQL；
- 将原始 User-Agent 暴露到 normalized context、API 或 Dashboard。

统一后，未来真正的破坏性协议变化从 `schema_version = 2` 开始，并需要重新建立兼容期、迁移策略和 deprecation policy。

## 6. 验收标准

### Contract

- 仓库中只有一份 Event Batch schema 和一份 Page View Event schema；
- Event schema 固定 `schema_version = 1`；
- Context schema 只保留一份；
- 不存在 `protocol/phase-*`、`event-batch-v2` 或 `page-view-event-v2` 路径；
- schema `$id` 和 `$ref` 不包含开发阶段名称。

### Runtime

- Browser SDK 只构造统一 Event；
- Transport 只发送统一 Batch；
- Collector 只使用统一 validator；
- V1/V2 feature flag 和 mixed-version branch 被移除；
- `analytics_enabled` 仍然可以独立控制 Phase 6 派生能力。

### Regression

必须通过：

```bash
pnpm protocol:validate
pnpm analytics:contract:validate
pnpm http:validate
pnpm check
pnpm test
cargo test -p collector
cargo test -p processor
DATABASE_URL=postgres://analytics:analytics@localhost:5432/analytics \
  pnpm test:integration
pnpm e2e:analytics
pnpm e2e:dashboard
git diff --check
```

并额外验证：

- 有 Visitor ID 的事件仍能产生 Visitor/Session/Dimension 数据；
- 没有 Visitor ID 的事件仍只产生 Page View 和允许的 Dimension 数据；
- Raw Event payload 不被修改；
- 旧 Page View API 和 Dashboard 行为不回归；
- `analytics_enabled = false` 时 Page View workflow 仍然工作；
- 新数据库可以从统一 migration baseline 正常初始化。

## 7. 非目标

本次 consolidation 不包含：

- 新的 Custom Event 协议；
- Protocol 自动代码生成；
- 多版本长期同时运行框架；
- Supabase/Flyway/Atlas 等 migration engine 替换；
- Sessionization、Parser 或 Dimension 语义调整；
- Analytics API response schema 重新设计；
- Dashboard UI 改版。
