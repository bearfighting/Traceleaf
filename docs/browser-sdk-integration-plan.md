# Browser SDK 对外接入与发布计划

> 状态：维护者已决定将项目版本对齐到 `1.0.0`，并通过 GitHub Release 提供 Browser SDK tarball；不发布到 npm。SDK 保持 `private: true`，`1.0.0` tarball 独立消费者验收已通过，GitHub Release 尚未创建。该工作不包含新增 Analytics 功能或扩大产品范围，MVP 其他功能继续冻结。导航观察范围按 [ADR-022](decisions/ADR-022-navigation-api-only-browser-sdk.md) 执行；History API 检测与 fallback 不在本轮范围。
> 目标：提供不依赖具体 Router 或 UI 框架的通用 Browser SDK，让目标网站通过同一套浏览器级导航观察实现页面浏览分析；SDK 故障不得影响目标应用。Chromium observer 验收目标现在包含 Next.js、React Router、TanStack Router、Vanilla、Vue、SvelteKit、Solid、Angular 和 Astro Playground。测试结果只作为受测 Chromium 与依赖版本的兼容性证据，不代表完整浏览器矩阵或对外支持承诺。首发设计不包含 Router 专用代码。

> 浏览器范围：本轮 Navigation API 验证只在 Chromium 中进行。维护者于 2026-10-11 明确暂缓 Firefox 与 Safari/WebKit 的兼容性和支持范围验收；当前不安排执行，且不代表通过或作出兼容性承诺。恢复时再决定最低支持版本，以及缺少 Navigation API 时的行为或替代方案；不预先承诺 History API fallback。

> Framework smoke-test 范围：在原有 Next.js、React Router、TanStack Router 与 Vanilla 基线之外，新增 Vue、SvelteKit、Solid、Angular 和 Astro playground。E2E 只证明本次锁定的依赖版本可在 Chromium 中初始化 SDK、收到 initial 事件并观察一次 push 导航。这不是浏览器兼容矩阵，也不自动形成框架支持或发布承诺。

## 后续发布目标体验

接入方应能完成以下步骤：

1. 从已确定的渠道安装通用 Browser SDK；不安装框架 adapter。
2. 在应用入口调用 `createBrowserAnalytics()`。
3. 由应用读取配置并传入站点 ID、Collector 地址和公开 Ingest Key。
4. 部署并在 Analytics API / Dashboard 验证页面浏览事件。

仓库内通用浏览器 SDK 的包名定为 `@traceleaf/browser`，物理目录仍为 `packages/analytics-browser`。当前发布候选版本为 `1.0.0`；根入口唯一初始化函数为 `createBrowserAnalytics()`，只导出该函数及其调用所需的 `Analytics`、`AnalyticsConsent` 和 `BrowserAnalyticsOptions` 类型。配置由调用方显式传入 `siteId`、`endpoint`、`ingestKey`；SDK 不读取宿主环境变量，宿主可自行读取环境变量后传入。根入口不导出底层 `createAnalytics()`、浏览器上下文工厂或 Visitor ID 工具。React 组件入口不属于本轮定稿范围。

### 简化的版本与发布流程

版本规则、SDK 发布、平台版本更新和精简验证门禁统一见[版本与发布流程](versioning-and-release-process.md)。目标部署 Collector 兼容确认和 Firefox/Safari/WebKit 验收目前暂缓，不属于当前 SDK 发布检查门禁，也不代表相关环境或浏览器已通过验收。

所有 Playground 使用同一个基于 Navigation API 的浏览器 observer 验证真实 Router 行为。Next.js、React Router、TanStack Router 专用 package、adapter 和 bridge 已从工作区移除。History API 包装、`popstate` 检测和兼容回退明确不属于本轮；若 Navigation API 覆盖不足，先记录证据，再另行评审下一步方案。

### 最小接入 API（首发接入）

仓库内入口通过一个初始化函数接入；SDK 的 `1.0.0` 发布候选通过 tarball 进行独立消费者验收。消费者从 GitHub Release 下载 tarball 后本地安装。所有框架和普通网站也使用相同函数：

```js
import { createBrowserAnalytics } from "@traceleaf/browser";

const analytics = createBrowserAnalytics({
  siteId: "site_example",
  endpoint: "https://collector.example/v1/events",
  ingestKey: "public-ingest-key",
});
```

调用方负责读取配置并传给 SDK。SDK 不探测 Next.js、Vite 或其他构建器的环境变量，也不提供 React 组件入口。

React 和非 React 应用都在合适的客户端入口调用同一个初始化函数。应用可以自行从框架公开环境变量或运行时配置读取值；SDK 不提供环境变量默认值，也不读取宿主环境变量。React 组件包装不属于当前范围。

高级自定义入口可以保留在独立子路径或标为高级用法；默认文档只呈现一个推荐入口。不要把 `analytics-core`、协议类型、缓冲区或 transport 的内部概念暴露给普通接入方。

配置包含 `siteId`、Collector `endpoint` 和公开 `ingestKey`。调用方可以按框架约定从公开环境变量读取这些值，再显式传入初始化函数。这些值会进入浏览器构建产物；仓库定义的 Ingest Key 本身就是公开接入标识，不是 secret，不能作为唯一安全边界。管理 token、数据库凭据等真正的秘密绝不能进入浏览器配置。接收控制由服务端 Origin policy 和限流承担。Ingest Key 语义遵循现有 [Ingest Key 指南](ingest-key.md)。

## 兼容性与可靠性约束

### 前后端契约兼容

- 开始实现前，盘点 Event Protocol、Collector ingest HTTP contract、认证、错误响应及 Analytics API 的现行 Schema、fixtures 和消费者。
- 本工作默认只能对现有协议和 API 做向后兼容的增量扩展。删除/重命名字段、改变字段含义、增加必填字段、改变状态码或响应语义均视为 breaking change。
- SDK 默认只发送当前 Collector 已支持的协议版本与请求格式。部署顺序必须保证 Collector 先兼容新格式，再发布会发送该格式的 SDK。
- 若接入目标无法通过当前契约满足，先单独提出协议/API 变更及兼容、迁移和回滚方案，经维护者确认后再实施；不得把 breaking change 隐藏在 SDK 发布工作中。
- 协议变更按仓库规则同步更新 JSON Schema、TypeScript / Rust 类型、examples、fixtures 和契约验证。新增能力先添加端到端 fixture。
- 尚未发布的 SDK 初始化 API 可以在正式发布前调整；一旦公开发布，按 semver 管理，不与后端协议版本混为一谈。

### Fail-open 契约

SDK 是辅助功能，任何 SDK 配置或运行时错误都不能阻止宿主应用启动、渲染或导航：

- 缺少或无效的公开配置时禁用 Analytics，不发请求、不抛出影响 React render/hydration 的异常。
- 开发环境对配置问题给出清楚、去重的 warning；生产环境静默禁用或至多给出一次非干扰诊断。
- 事件组装、浏览器 API、HTTP transport、错误回调等失败由 SDK 隔离并捕获，不向应用传播；允许丢弃失败事件。
- SSR 阶段不访问 `window`、`document` 等浏览器对象；客户端初始化不破坏 hydration。
- SDK 的 Navigation API observer 只观察已提交导航，不拦截、取消或改变导航结果。
- React Strict Mode 重复挂载不得造成重复订阅；卸载必须清理监听和定时器。
- 可提供 opt-in debug logging 或错误回调，但错误回调自身失败也不得传播到宿主应用。

## 当前实现基线与差距

仓库内 Browser SDK 位于 `packages/analytics-browser`，包名为 `@traceleaf/browser`，版本 `1.0.0`，并通过 `packages/transport` 提供默认 Fetch transport。通用 Navigation API observer 已接入 SDK，所有九个 Playground 共用此入口。当前 SDK 聚焦发布验收已通过，待创建 GitHub Release：

- `analytics-browser` 已构建为可通过 GitHub Release 分发的 tarball；`observer-core`、`transport` 等内部包继续保持 private workspace packages，SDK tarball 不依赖这些 workspace 包。
- `analytics-browser` 已支持调用方显式传入 `siteId` 和 `endpoint`/`ingestKey` 使用内建 Fetch transport，或注入自定义 `Transport`。SDK 不读取框架环境变量；配置无效时通过可选 `onError` 报告一次并返回禁用实例。持久化和重试仍不在 SDK 范围内。
- SDK 首发版本 `1.0.0` 的发布准备已启动；当前仓库已有 Chromium Browser SDK/Collector 链路及外部 tarball 消费者验收记录。目标部署兼容确认和 Firefox/Safari/WebKit 验收按维护者决定暂缓。History API 检测及 fallback 不在当前范围。
- MVP 其他功能继续冻结；当前状态与授权边界以 [`project-status.md`](project-status.md) 和 [`mvp-scope.md`](mvp-scope.md) 为准。本授权不批准新增 Analytics 功能或扩大产品范围。

## 实施阶段

### 0. 确认授权范围并盘点契约

- 已获准完成并发布现有 Browser SDK；MVP 其他范围继续冻结。
- 已更新 MVP Scope / project status，记录授权范围、发布边界和未完成验收状态。
- 盘点现有协议、Collector API、Origin policy、CORS、batch limits 和错误语义。
- 建立当前契约的兼容性基线；若需要 API/协议改变，先单独完成兼容方案和 ADR/契约评审。

**退出条件：**现有请求/响应 fixtures 可代表 SDK 所需链路；不存在未评审的 breaking change；不兼容缺口有单独批准的迁移方案。

### 1. 用 Navigation API 验证通用 Browser Observer

- 仅使用 Navigation API 的导航提交事件建立框架无关 observer；初始化时单独报告当前文档，不支持 Navigation API 的浏览器本轮只报告初始页面，不做任何 History API 回退。
- 在现有 Next.js、React Router、TanStack Router Playground 中验证框架对 `pushState`、`replaceState`、back/forward、pathname/search 更新、hash-only 更新及快速连续导航的实际触发行为。
- 明确成功提交、取消/失败、相同 URL 导航、hash-only 导航、search 变化、导航类型和 title 采集时机；检查多实例订阅、严格模式重复挂载、卸载清理和重复 Page View。
- 不修改或拦截导航；若 Navigation API 无法覆盖某场景，记录最小复现、受影响 Router/浏览器和影响，再由维护者决定是否恢复 adapter 或设计其他回退。

**退出条件：**通用 Navigation API observer 在三个现有 Router Playground 中对已约定导航场景有可重复的覆盖证据；取消、hash、search、title、快速连续变化和无 API 环境行为有明确结论；任何缺口都记录证据。本轮不以实现 History API fallback 或专用 adapter 作为退出条件。

当前进度：通用 Navigation API observer 已实现；`analytics-browser` 新增 `createBrowserAnalytics()`，负责创建 observer、接入 SDK 并在销毁时清理订阅。九个 Playground 均使用同一入口。Router 专用 packages 和其 CI/Docker/workspace 引用已移除。原有四个 Playground 的 Chromium E2E 验证取消、提交前拒绝、提交后 handler 失败（含 `navigateerror`）、正常提交、initial observer/Page View、observer title 和快速连续导航顺序；React Playground 还覆盖 Strict Mode，多实例 Page View 由 Vanilla Playground 覆盖。新增 Vue、SvelteKit、Solid、Angular 和 Astro 的 E2E 验证 initial 与 push 导航及事件 title。Observer 现从 `currententrychange` 补充观察没有对应 `navigate` 事件的已提交路由变化，以支持仅通过该浏览器事件暴露导航的客户端 Router；不包装 History API，不添加框架 adapter。2026-10-10 在 Chromium `153.0.8010.12` / Playwright `1.63.0` 下，九个 Playground 的 Navigation API E2E 全部通过，observer-core 11 条单测通过。Observer 单测覆盖 unsubscribe、多订阅隔离、快速提交及取消后继续导航。2026-10-10 发现并修复了快速提交顺序问题；修复后的历史复验连续两轮在三个框架 Playground 均通过。无 Navigation API 环境仍只有单测证据，尚无浏览器环境验证。

#### Chromium 快速导航验收记录（2026-10-10）

- 环境：Chromium `153.0.8010.12`，Playwright `1.63.0`。
- 命令：`pnpm e2e:navigation-api`。
- 结果：在 Next.js、React Router、TanStack Router 三个 Playground 各运行两轮。两轮中 Next.js 快速用例都通过；React Router 和 TanStack Router 都稳定失败：两次 `push` 各报告一次，URL 和类型正确，但事件时间戳次序为 second 在前、first 在后。React Router 示例时间为 `1791645995688`（second）/`1791645995707`（first）；TanStack Router 为 `1791645999190`（second）/`1791645999207`（first）。第一次 Next.js 的反序现象没有在两轮复验中重现。
- 既有场景：三种 Playground 每轮都通过原有 initial、取消、提交前拒绝、提交后失败及正常提交断言；快速导航失败后也继续执行了其他 Playground。
- 根因：Router 调用 `NavigateEvent.intercept()` 后，即使导航最终作为同文档导航提交，`destination.sameDocument` 仍可能为 `false`。原 observer 只在 `currententrychange` 读取当前 URL；极短间隔的提交通知到达时，`currentEntry` 可能已指向后一个目标。
- 修复：按 `navigate` 事件顺序登记目标 URL、导航类型和前一条目 key；用 `currententrychange.from.key` 匹配并确认提交后，按请求顺序发出事件。取消的候选不会发出，后续已提交导航仍可继续。`occurredAt` 在收到对应的 `currententrychange` 时采样；若通知乱序，则按报告顺序将后续时间戳校正为严格递增。已取消且仍从同一 history entry 发起的候选会在新请求时清理，不再导致后续页面标题丢失。快速导航之间的标题仍不可靠时会省略，避免把最终页面标题附到较早 URL。
- 修复后复验：重建 observer package 后连续运行两轮 `pnpm e2e:navigation-api`；Chromium `153.0.8010.12` / Playwright `1.63.0` 下 Next.js、React Router、TanStack Router 六个快速导航场景全部通过。每个场景断言两个 URL 按提交顺序、`push` 类型、恰好各报告一次、最终 URL 为第二个目标，时间戳按顺序且位于操作时间窗口内。原有取消、提交前后失败及正常提交场景也全部通过。
- 2026-10-10 后续修复复验：`pnpm --filter @web-analytics/observer-core test`（13 项通过）、`typecheck`、`build`、`format:check`、`git diff --check` 均通过；随后再次运行 `pnpm e2e:navigation-api`，Chromium `153.0.8010.12` / Playwright `1.63.0` 下三个 Playground 均通过。新增单测验证逆序 `currententrychange` 的时间戳按发出顺序校正，以及取消导航后标题仍归属新提交页面。此次浏览器 E2E 重验了已有快速导航与 Router 行为；取消后标题的新增回归目前由 observer 单测覆盖。
- 限制：只在 Chromium `153.0.8010.12` 验证，尚未在 Firefox 或 Safari/WebKit 测试；不支持 Navigation API 时只报告 initial 仍只有单测证据。本轮不增加 History API fallback。

Vanilla JavaScript Playground 是通用 Navigation API observer 的浏览器基线和当前验收目标，同时 Next.js、React Router 与 TanStack Router 用例继续验证框架行为。它使用 `navigation.navigate()`、`navigation.back()`、`navigation.forward()` 触发用例；不直接调用或包装 History API 来实现 observer，也不实现 `popstate` fallback。Playground 只作为测试目标，使用 workspace 私有 SDK 入口和 mock transport，不代表公开接入文档、SDK 发布或解除冻结。

#### Vanilla Playground Chromium 验收记录（2026-10-10）

- 目标：Vanilla JavaScript、Next.js App Router、React Router、TanStack Router。
- 环境：Chromium `153.0.8010.12`，Playwright `1.63.0`；仅验收 Chromium。Firefox/WebKit 与不支持 Navigation API 的真实浏览器行为后置到 SDK 功能完成后。
- 命令：`pnpm e2e:navigation-api`、`pnpm build:packages`、`pnpm --filter @web-analytics/vanilla-playground build`，以及 Vanilla 格式检查和 `git diff --check`。
- 结果：四个 Playground 的 Navigation API E2E 全部通过。Vanilla 覆盖 initial、push、replace、back/forward、search、hash 排除、取消、提交前拒绝、提交后失败、快速连续提交及多实例 Page View 语义。
- 多实例观察：同一文档和 `siteId` 下，initial Page View 只由第一个实例计入；之后每个活跃实例分别处理导航。销毁第二实例后，第一个实例继续采集，第二实例不再变化。此处记录当前行为，不定稿未来产品契约。
- 本记录不构成公开 SDK 发布或浏览器支持承诺。

### 当前计划状态审计

| 阶段                       | 状态                                                                                                                                                                                           | 尚未完成 / 应调整                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. 授权与契约盘点          | 授权范围已记录；[契约审计](browser-sdk-ingestion-contract-audit.md) 已记录请求格式、CORS/Origin、批次限制和错误映射                                                                            | 已修正三处错误 fixture 差异；目标部署 Collector 对当前 Protocol V1 的兼容性确认暂缓，仓库内同提交 E2E 不替代部署验证。授权仅限现有 Browser SDK 的发布准备与发布。 |
| 1. Navigation API observer | 基础实现完成，已纳入 Browser SDK 初始化入口；Chromium E2E 覆盖九个 Playground，含无 `navigate` 对应事件时的 `currententrychange` 提交观察；observer-core 11 条单测通过                         | 无 API 时仅 initial 的行为目前由单测覆盖；Firefox/Safari/WebKit 验收已暂缓。不包装 History API，不实现 fallback。                                                 |
| 2. 公开 API 与失败语义     | 接入入口已定稿；Chromium E2E 已验收 SSR/hydration、无效配置和错误回调异常隔离                                                                                                                  | Firefox/Safari/WebKit 支持范围及缺 Navigation API 时的真实浏览器行为已暂缓，尚未验收。                                                                            |
| 3. 通用 SDK 边界           | SSR/hydration、缺少/无效配置及宿主导航 fail-open 已由 Chromium E2E 覆盖；日志通过 `onError` 回调，正常与 transport 失败路径不写 console（2026-10-11）                                          | 完整运行时异常矩阵仍待验收；跨浏览器验证已暂缓。                                                                                                                  |
| 4. 默认 HTTP 与 fail-open  | 隔离 E2E 验证真实 SDK 请求进入 Collector，覆盖 503、连接失败、拒绝 Origin 的 fail-open 和 Chromium CORS 预检；批次及有限缓冲/flush 单测通过（2026-10-11）                                      | 不增加持久化队列或复杂重试；跨浏览器验证已暂缓。                                                                                                                  |
| 5. 公共包与文档            | SDK 包入口、README、LICENSE 和 tarball 内容检查已通过；当前候选为 `1.0.0` private tarball                                                                                                      | 浏览器兼容矩阵验收已暂缓；GitHub Release 尚未创建。                                                                                                               |
| 6. 端到端验证              | 部分完成；九种 Playground Navigation API E2E 及隔离的 SDK → Collector → PostgreSQL → Processor → API → Dashboard 链路、Chromium CORS 预检、SSR/hydration、空数据和失败状态均通过（2026-10-11） | Firefox/Safari 支持范围验证已暂缓；本记录不代表 Raspberry Pi 或生产部署验收。                                                                                     |
| 7. 独立安装与发布          | `1.0.0` focused release checks 和 private tarball 消费者验收通过；GitHub Release 尚未创建                                                                                                      | 内部运行时代码打入 SDK；`ulid` 与 `web-vitals` 为外部运行时依赖。需将 tarball 附加到 `browser-sdk-v1.0.0` Release。                                               |

当前明确的顺序调整：Browser SDK 默认使用通用 Navigation API observer，并移除 Router 专用代码。Firefox 与 Safari/WebKit 兼容性验证由维护者于 2026-10-11 明确暂缓，恢复工作需维护者明确提出。若之后验证发现 Navigation API 覆盖缺口，先记录证据并单独评审，不自动加入 History API fallback 或 Router 专用代码。

### 待完成工作 Checklist

以下清单跟踪当前未完成事项。现有 Browser SDK 的 GitHub Release 准备和发布已获限范围批准；MVP 其他功能继续冻结。Browser SDK 的产品部署验收与包发布验收分别跟踪。

#### 当前：Navigation API observer 验证（Chromium）

- [x] 在四个 Playground 中验证导航取消、提交前拒绝、提交后 handler 失败和正常提交，并断言 observer 事件数量及导航语义。
- [x] 修复并通过三个 Playground 的真实快速连续提交验收；修复后连续两轮 Chromium E2E 均通过（详见上方验收记录）。
- [x] 单测验证多个 observer 订阅独立收到 initial/导航事件，unsubscribe 只停止对应订阅；三个 React Playground 在 React Strict Mode 下 initial observer event 和 Page View 均恰好一次。
- [x] 在 Chromium 验证多个 observer 订阅及 SDK 多实例的导航 Page View 语义；同一文档、同一 `siteId` 的 initial Page View 只计一次，后续导航按活跃实例分别处理。产品语义仍待单独决定。
- [x] 让四个 Playground 的 E2E 断言 observer 导航事件中的 title，而不只检查页面标题；observer 单测验证快速连续提交时不会把最终页面 title 附到旧 URL。
- [x] 记录 Chromium 版本、Playwright 版本、命令及修复前后快速导航结果；无 API 时仅 initial 的结论目前由单测覆盖。
- [x] Vanilla JavaScript Playground 作为纯浏览器 observer 验收基线；四个 Playground 均在 `pnpm e2e:navigation-api` 执行。
- [x] Vue、SvelteKit、Solid、Angular 和 Astro 加入生产构建、类型检查和 Navigation API E2E；受测依赖版本均能构建/类型检查。E2E 检查 initial、目标 push 和对应 title。
- [x] Astro 5 ClientRouter 的客户端 push 由通用 `currententrychange` 观察补齐；不包装 History API，不添加框架 adapter。
- [x] 在 Chromium `153.0.8010.12` / Playwright `1.63.0` 运行 Navigation API E2E，九个 Playground 均通过；observer-core 11 条单测通过。
- [ ] 汇总漏报或语义差异；如需 History API fallback 或 router adapter，另行提交有证据的决策，不在本轮直接实现。

#### SDK 实施前置与实现

- [x] 记录维护者对现有 Browser SDK 发布准备与发布的限范围授权，并同步更新 MVP Scope 与项目状态；MVP 其他功能继续冻结。
- [x] 记录 Protocol、Collector HTTP contract、Origin/CORS、batch limits、错误语义和 fixtures 的现状；修正错误 fixture，并记录 Collector 优先于依赖新协议的 SDK 部署的兼容顺序。
- [x] 定稿仓库内初始化 API、包名和配置来源：`@traceleaf/browser` 根入口只提供 `createBrowserAnalytics()` 及其调用类型；调用方显式传配置，SDK 不读宿主环境变量。
- [x] Chromium E2E 验证 Next.js SSR/hydration、无效 SDK 配置、抛错的错误回调，以及 503、Collector 连接失败、拒绝 Origin 时宿主导航继续且无未处理页面异常（2026-10-11；详见下方隔离链路记录）。
- [x] 完成日志策略与默认 transport 有限缓冲/flush 的专项验收；transport 和 Browser SDK 单测通过（2026-10-11）。完整运行时异常矩阵仍待完成；跨浏览器验证已暂缓。
- [ ] 明确 Browser SDK、observer、Page View、身份/consent、buffer 与 transport 的边界和职责。
- [x] 复用现有 Fetch transport；`createBrowserAnalytics()` 根据显式传入的 `siteId`、`endpoint` 和 `ingestKey` 创建默认 transport。
- [x] 默认 Fetch transport 的真实 Collector 发送和 503、Collector 不可用、拒绝 Origin 的失败隔离由 Chromium E2E 验证（2026-10-11）。
- [x] 在隔离 Browser SDK E2E 验证 Chromium 发出的 Collector CORS 预检：204、匹配 Playground Origin、允许 POST 和 Content-Type/X-Ingest-Key（2026-10-11；详见下方预检验收记录）。
- [x] 完成有限缓冲/flush 和批次限制专项验收：Browser SDK 定时/容量触发/手动 flush、失败不重试及销毁清空；transport 100-event、UTF-8 字节拆分、超限拒绝和 keepalive 预算（2026-10-11）。
- [x] 实现内部通用 Browser SDK 初始化入口，由 SDK 默认创建并清理 Navigation API observer。
- [x] 定稿并实现通用根入口；React 组件入口不纳入当前范围，不增加 Router 专用 adapter。
- [x] 更新 vanilla JavaScript 接入示例、包名引用和接入计划/契约审计；SDK 当前准备以 `1.0.0` 首次独立发布。
- [x] Next.js、React Router、TanStack Router 和 Vanilla Playground 均通过 `@traceleaf/browser` 根入口接入；这些仓库内示例仍使用 private workspace 依赖。

#### SDK 发布验收与发布准备

- [x] 在隔离 E2E Compose 验证 Browser SDK 事件写入当前仓库 Collector/PostgreSQL，Processor 处理后由 Analytics API 和 Dashboard 展示；验证 initial 与客户端导航 Page View（2026-10-11）。
- [x] 在隔离 E2E Compose 验证 SSR/hydration、空日期成功响应和 Dashboard 空状态、Collector 503、连接失败、无效配置、抛错错误回调及 Origin 403 的 fail-open（2026-10-11）。
- [x] 在 Chromium 隔离 E2E 验收真实 Collector CORS 预检；日志策略、有限缓冲/flush 和批次限制专项验收通过（2026-10-11）。Firefox/Safari/WebKit 支持范围已暂缓。
- [x] 完成 Browser SDK 相关单元、集成、构建、类型检查与格式检查，并记录命令、环境和结果（2026-10-11；详见下方基础质量验收记录）。
- [ ] （暂缓）在目标部署环境确认 Collector Protocol V1 兼容性；当前 E2E 仅证明同一提交构建的 Collector 与 SDK 互通，不代表 Raspberry Pi/生产部署验收。
- [x] 完成包 exports、类型、浏览器入口、依赖许可、README/LICENSE 和 tarball 内容检查。
- [x] 确定打包方案：内部 workspace 运行时代码并入 SDK，生成包不依赖 monorepo workspace；外部运行时依赖仅为 `ulid` 与 `web-vitals`。
- [x] 在 monorepo 外从 tarball 安装并运行 ESM 导入、TypeScript 和 Vite 浏览器构建 smoke test；消费者无需 workspace 配置或手工安装内部包。
- [ ] （暂缓）验证 Firefox 与 Safari/WebKit 的目标支持范围；在发布说明中记录实测矩阵和不支持 Navigation API 时的行为。
- [x] 完成精简 SDK 发布检查：Protocol/HTTP fixtures、SDK 及直接依赖测试、类型检查、构建和 private tarball 消费者验收；本候选没有运行时行为改动，故未重复运行 Browser SDK E2E。
- [x] 统一首发候选版本为 `1.0.0`；生成 `artifacts/releases/traceleaf-browser-1.0.0.tgz`（31,464 bytes，6 个文件，SHA-1 `3c8fa2a00b9419583c332e2f7c430cc92e5262c3`）。
- [ ] 在 GitHub 创建 `browser-sdk-v1.0.0` Release，附上 `traceleaf-browser-1.0.0.tgz`；已明确暂缓的项目不作为本轮发布检查门禁。

#### Browser SDK 1.0.0 首发候选验收（2026-10-11）

- 版本：所有 first-party npm package manifest、Cargo workspace 与 Cargo.lock 中的 workspace crate 已对齐为 `1.0.0`；Protocol `schema_version` 保持 `1`。
- Protocol/HTTP：`pnpm protocol:validate` 与 `pnpm http:validate` 通过，HTTP 验证覆盖 30 个 fixtures。
- SDK 测试：protocol-ts、observer-core、analytics-core、browser SDK、transport 共 94 项单测通过；相同 package filters 的 `typecheck` 通过；SDK build 通过。
- 发布包：`pnpm --filter @traceleaf/browser package:acceptance` 通过；独立临时消费者完成 ESM 导入、TypeScript 检查和 Vite 构建。候选包为 `@traceleaf/browser@1.0.0`，保持 `private: true`。
- 格式/元数据：`pnpm format:check:docs`、`pnpm format:check`、`cargo fmt --check` 和 `cargo metadata --no-deps --format-version=1 --locked` 通过。
- 发布状态：不向 npm 发布；GitHub Release 尚未创建。当前环境没有 `gh` CLI，不能在本机直接上传 Release asset；tarball 已在 ignored `artifacts/releases/` 目录待上传。
- 范围：本候选只有版本和发布元数据变化，没有 SDK 运行时代码变化；Chromium CORS 和完整链路 E2E 结果见上方 2026-10-11 记录。Firefox/Safari/WebKit 与目标部署 Collector 兼容确认仍暂缓。

#### 隔离 Browser SDK 数据链路验收（2026-10-11）

- 命令：`pnpm e2e:browser-sdk`。
- 环境：本机隔离 E2E Compose 项目；PostgreSQL、当前仓库 Collector、Processor、Analytics API、Dashboard、Next.js Playground；Chromium / Playwright。runner 完成后已清理本次创建的 Compose 容器、网络和数据库卷。
- 结果：通过。真实 `@traceleaf/browser` 根入口在 Next.js SSR/hydration 后发送 initial Page View 和 `/about` 客户端导航 Page View；事件写入 PostgreSQL，经 Processor 后由 Analytics API 返回，并在 Dashboard Top Pages 中展示。空日期范围返回 200 和空 items，Dashboard 显示空状态。
- 失败隔离：通过。模拟 Collector 503、连接失败、无效 SDK 配置、抛错的错误回调及 Collector 对拒绝 Origin 返回 403；宿主页面仍可导航，未发现未处理页面异常。
- 本轮没有发现需要修改代码的阻塞问题。
- 范围：这是同一仓库版本的隔离 E2E 证据，不代表 Raspberry Pi/生产部署验收，也不构成 Firefox、Safari/WebKit 或无 Navigation API 浏览器兼容性结论。批次限制、有限缓冲/flush 和日志策略随后已通过针对性验收（见下方记录）；跨浏览器支持矩阵已暂缓。

#### Chromium CORS 预检验收（2026-10-11）

- 命令：`pnpm e2e:browser-sdk`、`pnpm --filter @web-analytics/transport test`、`pnpm --filter @traceleaf/browser test`、`cargo test -p collector --test http_ingestion`。
- 环境：隔离 E2E Compose、Chromium `153.0.8010.12` / Playwright `1.63.0`；Browser SDK 页面从 `localhost` 请求 `127.0.0.1` 上的 Collector，以确保真实跨 Origin 预检。E2E 完成后已清理创建的 Compose 容器、网络和数据库卷。
- 结果：全部通过。CDP Network 事件捕获浏览器真实发出的 `OPTIONS /v1/events`，响应状态为 204；`Access-Control-Allow-Origin` 与 Playground 页面 Origin 相同；允许方法包含 POST；允许请求头包含 Content-Type 和 X-Ingest-Key。HTTP 集成套件 14 项、transport 单测 23 项、Browser SDK 单测 40 项均通过。
- Browser SDK E2E 保留并通过原有数据链路、空数据、503/连接失败、无效配置、抛错错误回调和拒绝 Origin 断言。
- 范围：仅证明隔离 E2E 中 Chromium 的 CORS 预检行为；不代表生产/Raspberry Pi 部署或 Firefox、Safari/WebKit 兼容性验收。

#### Browser SDK 基础质量验收（2026-10-11）

- 构建：`pnpm build:packages` 通过，构建 Protocol TS、observer-core、analytics-core、Browser SDK、transport 和 playground-support。
- 单测：`pnpm --filter @traceleaf/browser --filter @web-analytics/observer-core --filter @web-analytics/transport test` 通过；Browser SDK 40 项、observer-core 14 项、transport 23 项。
- 类型检查：`pnpm --filter @traceleaf/browser --filter @web-analytics/observer-core --filter @web-analytics/transport --filter @web-analytics/nextjs-router-playground typecheck` 通过。
- 格式：上述相同 package filters 的 `format:check` 通过；发现并修正 `packages/transport/src/fetch-transport.test.ts` 的 Prettier 格式后，transport 23 项单测复跑通过。文档 Prettier 检查和 `git diff --check` 通过。
- 集成/E2E：Browser SDK 隔离链路与 CORS 预检 E2E，以及 Collector HTTP ingestion 集成测试结果见本节前两份记录。
- 范围：这是 Browser SDK 及其直接依赖和 Next.js Playground 的针对性验证，不替代完整仓库 CI、生产部署或跨浏览器验收。

#### 日志策略、缓冲与批次限制验收（2026-10-11）

- 命令：`pnpm --filter @traceleaf/browser --filter @web-analytics/transport test`、`pnpm --filter @traceleaf/browser --filter @web-analytics/transport --filter @web-analytics/nextjs-router-playground typecheck`、相同 filters 的 `format:check`、`pnpm e2e:browser-sdk`。
- 结果：全部通过。Browser SDK 单测 41 项、transport 单测 23 项；类型检查和格式检查通过。新增断言确认 transport 失败通过 `onError` 报告并使 `flush()` reject，SDK 不向 `console.warn`/`console.error` 写入内容。
- 已有专项断言覆盖缓冲定时 flush、达到配置容量时自动 flush、手动 flush 等待发送、destroy 清空未发送事件、失败批次不重试；Fetch transport 覆盖每请求最多 100 个事件、按 UTF-8 请求体字节数拆分并保持顺序、超大事件拒绝，以及 keepalive 单请求 60,000-byte 预算和超限整体拒绝。
- `pnpm e2e:browser-sdk` 同时通过真实 Chromium CORS 预检及 SDK → Collector → PostgreSQL → Processor → Analytics API → Dashboard 链路；runner 已清理隔离 Compose 容器、网络和数据库卷。
- 范围：日志策略只保证当前 Browser SDK 正常与已测失败路径不写 console，错误通过可选 `onError` 暴露；有限缓冲是内存缓冲，不提供持久化或重试。该记录不构成 Firefox/Safari/WebKit 或生产部署验收。

#### Tarball 打包实施记录（2026-10-10）

- 打包方案：使用 `tsup` 将 `analytics-core`、`observer-core`、`protocol-ts` 与 `transport` 运行时代码合并到 ESM 入口；`ulid`、`web-vitals` 保留为外部运行时依赖；`.d.ts` 由打包流程生成。
- 包元数据：`exports` / `main` / `types` 指向 `dist`；tarball 文件白名单为 `dist`、README 与 LICENSE。SDK 继续保持 `private`。
- 可重复验收命令：`pnpm --filter @traceleaf/browser package:acceptance`。脚本会先重建 SDK，再在系统临时目录生成 tarball、检查内容和 workspace 依赖、创建独立 Vite + TypeScript 消费者、安装 tarball 并构建及类型检查；tarball metadata 由 Node 内置 gzip 读取，不依赖系统 `tar` 可执行文件。
- 实际结果：`pnpm --filter @traceleaf/browser build` 通过，生成 `dist/index.js`（37.96 KB）和合并声明 `dist/index.d.ts`（4.06 KB）。`pnpm --filter @traceleaf/browser package:acceptance` 通过：清单包含 package metadata、README、LICENSE、JS 和声明，未发现源码测试文件；metadata 仅列 `ulid`、`web-vitals`，且 `private: true`；临时目录中的原生 ESM 导入、`createBrowserAnalytics` / `Analytics` / `AnalyticsConsent` / `BrowserAnalyticsOptions` 类型检查及 Vite 浏览器构建均成功。打包产物中没有 `@web-analytics/*` 引用。
- 未解决项：SDK 仍保持 private，尚未发布 registry。Firefox/Safari 兼容矩阵已暂缓；完整 SDK → Collector 产品验收仍按计划执行。这些不属于本次独立 tarball 消费验收。

#### 暂缓：Firefox 与 Safari/WebKit 兼容性

- [ ] 为 Firefox 和 Safari/WebKit 建立最低版本及实际版本的测试矩阵。
- [ ] 验证初始页面、客户端导航、back/forward、pathname/search、hash、取消/失败、快速连续导航和 title 行为。
- [ ] 根据实测结果确定浏览器支持范围，以及不支持 Navigation API 时的行为；若提议 fallback，另行评审后再实现。
- [ ] 将兼容性结果和支持范围写入接入文档与发布说明，再对外承诺支持范围。

### 2. 锁定公开接入与失败语义

当前 workspace 内部接口已经落地：两种 transport 配置互斥，site ID、endpoint、ingest key 和自定义 `sendBatch` 在 observer 启动前校验；无效配置不会启动 observer 或访问 visitor ID。SDK `1.0.0` 的独立 tarball 发布验收已通过，待创建 GitHub Release。

- 已定稿仓库内通用浏览器包名 `@traceleaf/browser` 和根入口 `createBrowserAnalytics()`；调用方显式传入配置，宿主自行决定环境变量读取方式。
- SDK 不读取构建器环境变量；endpoint 不设硬编码默认值。React 组件入口不纳入本项。
- 明确缺配置、非法配置、SSR、导航订阅、transport 失败和日志策略。
- 增加可执行的契约示例和验收用例；记录公开包 API 的 semver 策略。

**退出条件：**维护者可以仅凭接入示例判断安装、初始化和禁用行为；公开配置与服务端秘密边界清晰，公开 Ingest Key 的语义与现有指南一致。

### 3. 固化通用 SDK 边界

- 保持 Browser SDK 不依赖 React、Next.js、Vite 或具体 Router；事件构造、上下文、身份、consent、buffer 和 transport 不依赖框架。
- 通用 Browser Observer 只将浏览器导航信号转换为稳定的 `NavigationEvent` 并管理订阅生命周期；遵循 `observer-core` 的 `NavigationObserver` 契约，不承担 Page View 统计、Session 或 HTTP 发送职责。
- 提供框架无关的初始化/配置入口，使所有框架复用同一实现，而不是复制配置解析、错误隔离或 transport 代码。
- 验收首次页面、客户端导航、back/forward、重复订阅与清理、SSR/静态构建安全、缺配置 fail-open、导航不被干扰，以及共享导航 fixtures。

**退出条件：**目标框架和网站都通过同一个 observer 与初始化入口工作；框架升级不要求维护对应的 SDK adapter 版本矩阵。

### 4. 完成默认 HTTP 上报与 fail-open SDK

- 核对现有 `packages/transport` Fetch 实现与 Collector contract；复用或按需调整，避免创建重复实现。
- 让通用 SDK 入口能够从 `siteId`、`endpoint` 和公开 `ingestKey` 创建默认 transport，不要求消费者注入内部 Transport。
- 明确有限缓冲、批次、页面离开时尽力 flush 和失败处理。第一版不引入持久化队列、复杂重试或超出 MVP 的基础设施，除非契约验证证明必要。
- 落实前述 fail-open 行为和 SSR/React 生命周期边界。

**退出条件：**单测和集成测试证明正确事件可到 Collector；无配置、错误 endpoint、Collector 不可用和回调抛错均不会向宿主应用传播异常。

### 5. 固化仓库内 Browser 包入口与接入文档

- `@traceleaf/browser` 根入口仅提供 `createBrowserAnalytics()` 和所需类型；不提供 React 组件入口。
- 接入方自行读取配置并显式传入；文档说明 `1.0.0` 首发候选及当前 Chromium 验证范围。
- 在 Vanilla JavaScript、Next.js、Vite + React Router 和 Vite + TanStack Router Playground 中使用同一通用 observer/SDK，验证示例可复制使用。

**退出条件：**九个 Playground 均使用相同 workspace 包与导航观察实现；仓库内 API、配置来源和发布状态在文档中一致。外部安装能力由阶段 7 单独验收。Astro 5 ClientRouter 通过通用 `currententrychange` 观察成功上报客户端 push；本次 Chromium 结果不构成框架支持承诺。

### 6. 验证端到端和兼容性

- 使用共享 protocol/HTTP fixtures 验证 SDK 请求和 Collector 校验一致。
- 验证首次加载、push/replace、back/forward 与 pathname/search 更新行为，以及必要的重复事件去重语义。
- 验证 CORS、Origin policy、batch validation、错误响应、Collector 不可用和空配置场景。
- 验证部署兼容顺序：旧 SDK/旧格式仍可被新 Collector 接收；新 SDK 不发送旧 Collector 不认识的格式。
- 运行相关单元、集成、Playground E2E、构建与格式检查；记录结果和环境。

**退出条件：**完整 browser → Collector → storage/processor → Analytics API/Dashboard 流程可验证；失败状态可处理；兼容矩阵有证据。

### 专用 Router adapter 的例外评审

Astro、Solid、Vue、Svelte、Angular 以及各 Router 默认复用同一个 Browser Observer，不规划专用 SDK adapter。若未来发现通用浏览器信号无法捕获某项重要导航，必须先提供 Vanilla 与受影响框架的复现用例，证明漏报影响和浏览器级解决方案的限制，再单独评审 adapter 是否值得承担实现、测试、版本兼容和长期维护成本。Astro 的静态页面/客户端视图切换等差异先通过通用观察验证，不预先引入框架分支。

### 7. 独立安装验证与发布

- SDK 保持 `private: true`；内部运行时代码已打入包内，workspace 包不作为外部运行时依赖。
- 检查 exports、类型声明、浏览器入口、依赖许可、README、LICENSE 和 tarball 内容。
- 在 monorepo 之外建立消费者 smoke test：从生成的 tarball 安装并构建运行。
- 使用项目统一的简化版本规则和 SDK 聚焦检查；通过后创建 GitHub Release 并附加 `@traceleaf/browser@1.0.0` tarball。

**退出条件：**干净外部消费者无需 workspace 配置即可安装、构建和运行；发布包无遗漏运行文件；版本和发布流程可审查。

## Browser SDK 发布验收标准

- Next.js App Router、Vite + React Router、Vite + TanStack Router、Astro、Solid、Vue、Svelte、Angular 与普通网站均通过同一通用 Browser SDK 接入。
- 核心 SDK 与导航观察保持框架无关；所有首发目标共用同一个 observer，不维护框架专属导航代码。
- 浏览器事件遵循已批准的现行 protocol 与 Collector contract；没有未批准的前后端 breaking change。
- 调用方传入的配置缺失/错误、SDK 运行时异常和服务端不可用都不会影响宿主应用使用；环境变量的读取由应用负责。
- Vanilla JavaScript 基线、框架 Playground E2E 与独立消费者安装验证覆盖通用导航观察和完整接入路径。
- 文档、Schema/fixtures、支持矩阵、构建/CI 与发布配置随实现同步完成。

Firefox 与 Safari/WebKit 兼容矩阵目前由维护者明确暂缓，尚无实测支持矩阵；恢复该工作后，再根据结果决定最低版本及不支持 Navigation API 时的产品行为。

## 明确不包含

- 超出本计划明确列出的仓库内包名、根入口和配置来源定稿，继续扩展 SDK 功能或对外发布；这需要另行排期和授权。
- 将管理 token、数据库凭据或其他真正的 secret 注入浏览器代码。公开 Ingest Key 按现有指南作为网站接入配置使用。
- 为 SDK 发布而顺手重构 Analytics API、Collector API 或事件协议。
- 未经单独评审的 breaking change。
- 离线持久化队列、复杂重试、Router 专用 adapter 或超出目标接入体验所需的功能。专用 adapter 只能经独立证据和维护成本评审后另行决定。
