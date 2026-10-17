# @web-analytics/transport

[English](README.md) | [项目概览](../../README.zh-CN.md)

此内部 TypeScript workspace package 实现 Browser SDK 的事件传输边界，为 SDK 和 Playground support 提供传输实现；它不观察导航，也不定义协议 schema。

## 开发

从仓库根目录运行：

```bash
pnpm --filter @web-analytics/transport build
pnpm --filter @web-analytics/transport typecheck
pnpm --filter @web-analytics/transport test
```

本包依赖 `analytics-core` 和 `protocol-ts`。协议 schema 的权威来源仍是 [`protocol/`](../../protocol/README.md)。此包不单独发布给消费者。另见 [Browser SDK 接入指南](../../docs/browser-sdk-integration-plan.md)和[项目状态](../../docs/project-status.md)。
