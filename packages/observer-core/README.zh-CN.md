# @web-analytics/observer-core

[English](README.md) | [项目概览](../../README.zh-CN.md)

提供框架无关的导航契约、供测试和开发使用的内存 observer，以及 Browser SDK 使用的浏览器 Navigation API observer。

浏览器 observer 报告初始文档和已提交的同文档导航条目，不依赖 Router 库，也不拦截导航。浏览器不支持 Navigation API 时只报告初始文档。共享导航 helper 保持浏览器和内存 observer 的 `NavigationObserver` 契约一致。

## 开发与验证

```bash
pnpm --filter @web-analytics/observer-core build
pnpm --filter @web-analytics/observer-core typecheck
pnpm --filter @web-analytics/observer-core test
```

本包不实现统计、Session 或 Transport 逻辑。设计边界见 [ADR-022](../../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md)。
