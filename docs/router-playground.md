# Router Playgrounds

Router Playgrounds 是各 Router Adapter 的真实浏览器测试目标。每个 playground 使用统一的 `RouterAnalyticsBridge` facade、MockTransport 和 Navigation Debug Panel；不实现 Session 或统计逻辑。

## 启动

Host 模式：

```bash
pnpm dev
pnpm dev --router react
pnpm dev --router tanstack
```

Docker 模式：

```bash
pnpm docker:dev
pnpm docker:dev --router react
pnpm docker:dev --router tanstack
```

Next、React Router、TanStack Router 的默认端口分别为 `3000`、`3101`、`3102`。

## 本地 Collector 配置

Playground 默认使用 MockTransport。使用本地开发 Compose overlay（`pnpm dev:up` 或 `pnpm docker:dev --with-backend`）时，在 `.env` 中显式设置 `LOCAL_DEV_INGEST_KEY`；该值由三个 Playground SDK 共用，也作为显式 seed 的 key 输入。Site 固定为 `site_example`，但必须通过 `--seed-init`（或 `--seed`）显式创建；普通启动不会写入 Site。缺少 key 时显式 seed 会失败，不会生成替代值。

独立运行或仅使用基础 Compose 时，Browser SDK 可通过 `NEXT_PUBLIC_ANALYTICS_TRANSPORT`、`NEXT_PUBLIC_ANALYTICS_ENDPOINT`、`NEXT_PUBLIC_ANALYTICS_INGEST_KEY` 和 `NEXT_PUBLIC_ANALYTICS_SITE_ID` 配置。基础 Compose 的 SDK 设置只是客户端配置，不会初始化平台数据库。示例值见仓库根目录 `.env.example`，仅供本地开发。

统一 facade 的 import 取决于 Router：

```tsx
import { RouterAnalyticsBridge } from "@web-analytics/router-adapters/react-router";

<BrowserRouter>
  <RouterAnalyticsBridge analytics={analytics} />
  <Routes />
</BrowserRouter>;
```

Bridge 必须位于对应 Router Provider 内，一个页面只挂载一个 Router Bridge；不会自动探测 Router。底层 `observer-next`、`observer-react-router` 和 `observer-tanstack-router` 仍可独立使用。

## 页面场景

| 页面                | 用途                 |
| ------------------- | -------------------- |
| `/`                 | 初始页面加载         |
| `/about`            | 普通页面导航         |
| `/products/example` | 动态路由             |
| `/search?q=test`    | Search params        |
| `/nested`           | 共享 layout 的父页面 |
| `/nested/child`     | 共享 layout 的子页面 |

页面底部的 Navigation Controls 提供：

- Next `<Link>` 导航
- `router.push()`
- `router.replace()`
- `router.back()` 和 `router.forward()`
- Search params 更新
- Hash 更新

## Navigation Debug Panel

Debug Panel 显示：

- 当前 URL
- pathname
- search params
- hash
- `document.title`
- 当前页面生命周期内的导航日志

日志包含 timestamp、previous URL、current URL、navigation type 和 path。标准 NavigationEvent 可观察 initial、pathname、search params、push、replace、back / forward；hash 仍由 Playground 单独显示。

Hash 变化只作为原始 Router 行为记录，不进入标准 NavigationEvent，也不决定是否计为未来的 Page View。

## 扩展场景

新增场景时只修改 Playground 页面和导航控件，并同步更新本文件的场景表。正式导航契约位于 `observer-core`，Next.js 集成位于 `observer-next`；Playground 不承担 Analytics 事件生成或发送职责。
