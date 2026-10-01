# ADR-013：Site 身份、生命周期与 onboarding 语义

- Status: Accepted
- Date: 2026-09-28
- Related: [ADR-007](ADR-007-capability-oriented-configuration.md), [ADR-008](ADR-008-internal-capability-boundaries.md), [M0a baseline](../m0a-baseline-and-decisions.md)

## Context

当前系统用 `site_id` 关联事件和配置，但没有 Site Registry，也没有通过产品创建 Site 的流程。capabilities 按 Site 管理，ingest policy 按 Site 和 environment 管理。新的 Site Registry 必须保留现有数据身份和运行语义，同时为新用户提供清晰的首站点默认值。

## Decisions

1. 新 Site ID 由 Site Management 服务生成，格式为 `site_` 加 26 位 Crockford Base32 ULID（首字符限定为 `0`–`7`），稳定且不从名称或 URL 派生。显示名称可重复、可修改；网站 URL 是可修改元数据，不作为 Site ID 或唯一键。Registry 迁移保留每个历史 Site ID。
2. 新建 Site 要求非空显示名称和 HTTP(S) 网站 URL。无可靠 URL 的历史 Site 可迁入并标为 `needs_attention`；不得根据 Allowed Origin 自动写入权威 URL。
3. 一个 Site ID 可关联多个 environment。首次 onboarding 创建一个显式 environment，UI 默认建议值为 `production` 且允许修改；这不是 Event Protocol 或 Collector 的隐式 default。开发 seed 使用 `development`。environment 的真实策略不存在或未启用时，Collector 不接受事件。
4. Site 生命周期 `active/archived` 与由元数据/必要配置推导的 setup 状态 `ready/needs_attention` 分离。缺网站 URL 本身不改变已有有效 policy 的采集行为；缺少有效 policy 时保留历史报告但拒收新事件。
5. 归档阻止该 Site 的新事件，保留历史分析数据、key 摘要和审计。恢复不会自动启用任何 environment policy，管理员必须明确确认/启用。首版不提供物理删除；隐私删除另行定义。
6. 新建 Site 默认仅开启必需的 Page Views，其余当前已实现能力初始关闭，管理员可选择；服务端按 capability manifest 校验依赖。迁移现有 Site 时保留当前有效能力与策略，不应用新建默认值，不清除 activation windows 或历史事实。
7. 创建操作具有幂等语义：客户端请求 ID 与规范化请求摘要、最终 Site ID 关联。相同 ID 和相同摘要重试返回已创建 Site 的元数据，不再次返回明文 key；相同 ID 对应不同摘要返回冲突。请求 ID 关联在 Site 生命周期内不设过期时间；归档不解除关联，Site ID 不得重用。若首次响应丢失，管理员通过 replacement key 恢复。M5 确定 API wire shape、摘要字段规范和非明文存储形式，但不能缩短上述幂等保证。
8. Site URL 仅按 HTTP(S) 语法与 Origin contract 校验，且网站 URL 的 Origin 必须出现在初始 `allowed_origins` 中。首版不从 Dashboard 服务端请求用户 URL；可达性与域名所有权验证需要独立 SSRF/验证设计。
9. M5.1 将 Site 创建幂等摘要冻结为规范化请求的 RFC 8785 canonical JSON 的 SHA-256；归一化规则、管理 API wire format、Site 版本/ETag 与持久化约束见 configuration contract。创建请求不得包含可配置的 Page Views 开关，baseline 始终为 enabled。
10. Site 创建时首个 environment policy 固定启用，限流为 600 requests/minute，初始 Ingest Key active；客户端不能提交这些策略字段。

## Consequences

- M3 的 Registry importer 必须合并来自配置、definitions、raw events 和 derived facts 的历史 Site ID，并保留来源核对报告。
- M5 的创建事务必须一次性建立 Registry、capability configuration、activation windows、首个 environment policy、key digest、请求幂等记录和审计；请求 ID 与 Site 的关联在 Site 生命周期内保留，具体 API contract 在实现前另行冻结。
- UI 的 `production` 是创建表单默认值；其他运行时路径仍需显式 environment。
- 首次明文 key 仅在成功创建响应出现；服务端不得为幂等重试存储可恢复明文。
- `archived` 是生命周期状态，不表示物理删除或分析数据删除。

## Alternatives considered

- 从 display name 或 URL 生成 ID：拒绝；名称/URL 可变且会暴露业务信息。
- 由 Origin 自动推断旧 Site URL：拒绝；安全接收 origin 不能证明 canonical website URL。
- 归档即删除配置、key 或历史数据：拒绝；历史查询和审计需保留，Collector 必须明确拒绝新事件。
- 无环境名时隐式使用 `production`：拒绝；UI 可预填，但持久化与协议调用必须有显式 environment。
