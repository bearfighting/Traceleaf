# @web-analytics/analytics-core

[English](README.md) | [项目概览](../../README.zh-CN.md)

提供与框架无关的 Page View 事件工厂和同步 `beforeSend` 处理管线，是 Browser SDK 与平台开发使用的内部 workspace package。

本包不访问浏览器 API，也不负责发送、缓冲或持久化事件。导航观察由 `observer-core` 提供，传输由 `transport` 提供。

## 开发与验证

从仓库根目录运行：

```bash
pnpm --filter @web-analytics/analytics-core build
pnpm --filter @web-analytics/analytics-core typecheck
pnpm --filter @web-analytics/analytics-core test
```

此包不是独立发布的产品包。接口与事件定义应遵循 [`protocol/`](../../protocol/README.md) 中的机器可读协议。另见 [Browser SDK 接入指南](../../docs/browser-sdk-integration-plan.md) 和[项目状态](../../docs/project-status.md)。
