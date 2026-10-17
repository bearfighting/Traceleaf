# Protocol 与契约目录

[English](README.md) | [项目概览](../README.zh-CN.md)

此目录按稳定的契约含义和版本组织，而不是按引入契约时的项目阶段组织：

```text
events/schemas/         统一事件 envelope schema
events/examples/        规范事件示例
events/fixtures/        有效和无效协议 fixture
contexts/               统一 Browser Context schema
capabilities/            内部 Analytics capability 契约及依赖
contracts/<service>/    HTTP 与 Analytics API 服务契约
contracts/configuration/current/  配置 schema、管理 API 和审计契约
scenarios/<domain>/     跨服务语义场景
```

事件和上下文 schema 是跨语言权威来源。服务契约描述传输或查询行为，scenario 描述多个实现共享的处理语义。

统一 Event Protocol 使用 `schema_version: 1`；当前完整契约包括 Visitor ID 和 Browser Context。不要在 `protocol/` 下新增 `phase-*` 或临时 Event Protocol v1/v2 rollout 目录。没有独立公开版本的内部服务契约使用 `current/`。

协议定义变更时保持 `schema_version: 1`。即使定义发生破坏性变化，也必须先获得项目所有者明确批准，才能升级版本。详见 [ADR-023](../docs/decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md)和[协议指南](../docs/event-protocol.md)。
