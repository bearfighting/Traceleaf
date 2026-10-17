# @web-analytics/playground-support

[English](README.md) | [项目概览](../../README.zh-CN.md)

为仓库中的浏览器和框架 Playground 提供共享 TypeScript 工具，包括用于本地验证导航和事件创建的 mock 传输路径。本包服务于示例，不是正式分析集成，也不是 Router adapter。

## 开发

```bash
pnpm --filter @web-analytics/playground-support build
pnpm --filter @web-analytics/playground-support typecheck
pnpm e2e:navigation-api
```

此 workspace package 依赖 `analytics-core`、`protocol-ts` 和 `transport`。另见 [Playground 索引](../../examples/README.md)、[Navigation API 决策](../../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md)和[项目状态](../../docs/project-status.md)。
