# @web-analytics/protocol-ts

[English](README.md) | [项目概览](../../README.zh-CN.md)

TypeScript 接口与统一初始 Event Protocol 和 Browser Context 契约保持一致。JSON Schema 是协议的权威来源；本包不含运行时浏览器或框架依赖。

本包仅提供协议类型。Visitor ID 生成和 Browser Context 采集由运行时 SDK 负责。

## 开发与验证

```bash
pnpm --filter @web-analytics/protocol-ts build
pnpm --filter @web-analytics/protocol-ts typecheck
pnpm --filter @web-analytics/protocol-ts test
pnpm protocol:validate
```

协议变更必须同步维护 schema、类型、examples 和 fixtures，并遵守[协议升级决策](../../docs/decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md)。
