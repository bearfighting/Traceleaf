# `@traceleaf/browser`

[English](README.md) | [项目概览](../../README.zh-CN.md)

`1.0.0` tarball 候选已通过针对性发布检查，但 GitHub Release 尚未创建。可从干净检出构建 package，并在其目录中打包以供本地评估：

```sh
pnpm --filter @traceleaf/browser build
cd packages/analytics-browser
npm pack
```

在消费者项目中安装生成的 `.tgz` 文件进行本地评估：

```sh
npm install /path/to/traceleaf-browser-1.0.0.tgz
```

发布状态见[项目状态](../../docs/project-status.md)。

此浏览器 SDK 运行时将浏览器 Navigation API 条目转换为 Protocol V1 Page View 事件。

使用 `createBrowserAnalytics()` 可进行框架无关的配置。它会自动启动 Navigation API observer，并在调用 `destroy()` 时取消订阅。可传入 `siteId`、`endpoint` 和 `ingestKey` 使用内置 Fetch transport，也可提供自定义 `transport`。SDK 不读取环境变量；应用应自行读取配置并传入：

```js
import { createBrowserAnalytics } from "@traceleaf/browser";

const analytics = createBrowserAnalytics({
  siteId: "site_example",
  endpoint: "https://collector.example/v1/events",
  ingestKey: "public-ingest-key",
  consent: "denied",
});

analytics.setConsent("granted"); // 仅在用户同意设置允许采集时调用。
```

无效或不完整的配置会禁用实例，不启动 observer，也不采集数据。若提供 `onError`，会收到一次初始化错误；否则 SDK 保持静默。禁用实例不会因 consent 变化而恢复，修正配置后应创建新实例。`consent` 默认为 `"denied"`。

测试和自定义传输可传入 transport，而不设置 `endpoint` 和 `ingestKey`：

```ts
const analytics = createBrowserAnalytics({ siteId: "site_example", transport });
```

本 package 支持可注入上下文、`beforeSend`、有界内存缓冲、定时/手动 flush 和自定义 transport。内置 Fetch transport 将批次发送到 Collector。本 package 不实现持久化或重试。

实现边界见 [Navigation API 决策](../../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md)、[HTTP ingestion fixture](../../protocol/contracts/http-ingestion/current/fixtures/accepted-single-event.json)和[项目状态](../../docs/project-status.md)。
