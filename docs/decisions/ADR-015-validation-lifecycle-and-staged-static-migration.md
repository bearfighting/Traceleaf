# ADR-015：验证器生命周期与分阶段静态校验迁移

- Status: Accepted
- Date: 2026-09-29
- Related: [Protocol Schema and Static Runtime Models](../protocol-static-runtime-design.md), [M0b checklist](../m0b-protocol-static-runtime-checklist.md), [ADR-014](ADR-014-runtime-configuration-authority.md)

## Context

M0b 对 Event Batch V1 和 Stored Environment Policy V1 的评估显示，静态类型及当前生成候选不能单独保证所有 Schema 与语义约束。Collector 已在启动时创建事件 Schema validator 并注入 HTTP 应用状态，但 Stored Environment Policy validator 仍在每轮数据库刷新时重新解析、编译。直接移除生产 Schema 校验会早于 parity 证据；无限期保留热路径重复构造也没有必要。

## Decisions

1. **分阶段迁移。**跨语言 parity 尚未完成并审查前，保留两个 M0b 样本的生产运行时 Schema 校验。parity 结果完成后，按 contract 决定是否改为静态解析和显式校验；类型生成成功本身不是切换依据。
2. **启动期构造并注入。**每个 contract 的 validator 由服务启动层构造，注入其消费者并在生命周期内复用。Handler 和配置 refresh 循环不得加载、解析或编译 Schema。
3. **按契约拆分具体验证组件。**事件与 Stored Environment Policy 使用独立的具体验证组件，分别由启动层构造并传给 HTTP 应用和 `RuntimePolicyManager`。现阶段不增加 trait/interface；只有出现第二种真实实现或替换需求时再抽象。
4. **Schema 与语义规则分层。**Schema validator 负责 Schema 定义的结构、格式及范围规则；Serde/静态模型负责解码；显式业务校验继续负责 batch 单站点、Custom Event properties 隐私/资源约束、Web Vital 关联及策略文档与数据库行身份的一致性等语义规则。静态化后也必须保留这些语义检查。
5. **保持已有外部错误语义。**事件验证拒绝继续映射到统一 `invalid_event_batch`，不公开 Schema 引擎的诊断细节。无效 stored policy 继续保留 last-good 配置并报告 stale。内部诊断可分类以便排查，但不是客户端 contract。
6. **Schema 保留在 CI。**无论某 contract 是否静态化，JSON Schema 与 canonical fixtures 继续用于开发期/CI 校验。生产静态化仅在 parity 证据支持且兼容要求明确后按 contract 决定。
7. **范围受限。**本 ADR 确定 M0b 两个样本及 Collector 直接消费者的迁移边界；其他配置、管理 API 与 capability contract 由各自阶段决策。

## Consequences

- Collector 事件 validator 生命周期已符合启动期注入目标；policy validator 每轮 refresh 重编译是已知差异，应由后续实施任务调整，M0b 第五步不改生产代码。
- 验证依赖按契约拆分，避免事件与策略数据模型耦合；也不提前引入当前没有使用场景的替换接口。
- 第六项 parity 需要分别记录 Schema 判定、静态解析/语义判定和当前服务结果。所有差异要么修正要么被明确接受，之后才可作静态化决策。
- 切换到静态运行时验证时，仍须保持对不可信 JSON 的运行时检查以及既有 HTTP 错误和 policy stale/last-good 行为。
