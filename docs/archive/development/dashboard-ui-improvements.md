# Dashboard UI 改进方案

- Status: M7a shadcn/ui reacceptance complete (2026-10-04); M7c complete; M7b.1–M7b.3 delivered; M7b.4 product acceptance and M7b.5 browser E2E closeout are deferred to M10 (2026-10-03)
- Scope: Dashboard information architecture and UI foundation
- Overall sequence and gates: [Platform Improvement Roadmap](platform-improvement-roadmap.md)
- M7b Analytics reports execution checklist: [M7b Analytics Reports Checklist](m7b-analytics-reports-checklist.md)
- M7c Settings execution checklist: [M7c Site Settings Checklist](m7c-settings-checklist.md)
- Related: [Capability-oriented configuration (ADR-007)](../../decisions/ADR-007-capability-oriented-configuration.md)
- Site creation and Settings behavior: [Site Onboarding and Settings Design](site-onboarding-settings-design.md)

## 背景

当前 Dashboard 把品牌标题、Analytics / Settings 导航和筛选控件挤在同一块横向区域。标题说明、站点与日期筛选、维度和定义版本之间缺少层级；所有 analytics 报表也集中堆叠在同一个页面。随着 capability 增加，这种布局会继续变得拥挤，用户也难以找到特定报表。

本方案为 Analytics 和 Settings 建立清楚、可扩展的导航骨架，并把 Analytics 内容按用户可理解的 capability 报表分组。当前阶段先重组已有数据和 API，不假设后端已经支持尚未实现的指标。

## 设计目标

- 顶部 Header 承载产品标识和一级导航 Analytics / Settings。
- Analytics 内使用 Sidebar 导航到 Overview 和 capability 报表。
- 标题、全局筛选器、页面内容分区呈现，避免互相挤压。
- 新增 capability 时有稳定的导航、页面和状态展示位置。
- 使用 Tailwind CSS 作为布局与样式基础，使用 shadcn/ui 组件作为可维护的基础控件。
- Analytics 报表视觉迁移保留现有查询 API、Server Component 数据加载和 capability contract 语义；Settings 的新增管理 API 与权限边界遵循站点接入设计。

## 信息架构

```text
Global Header
├── Web Analytics
├── Analytics
└── Settings

Analytics Sidebar
├── Overview
├── Traffic
│   ├── Pages
│   └── Dimensions
├── Audience
│   ├── Visitors
│   └── Sessions
├── Engagement
│   └── Custom events
├── Experience
│   └── Web Vitals
├── Geography
│   └── Countries
└── Outcomes
    ├── Conversions
    └── Funnels
```

Sidebar 使用面向用户的报表名称，而不是直接暴露内部 capability ID。`browser_context` 是维度数据的输入能力，与 `dimensions` 一起支撑 Dimensions 页面，因此不单独显示成重复导航项。Overview 汇总站点的关键指标；Pages 承载页面趋势和热门路径。

页面可采用 `/dashboard` 作为 Overview、`/dashboard/[report]` 作为报表页、`/dashboard/settings` 作为配置页。最终路由实现应继续支持站点和筛选参数的分享与刷新；现有 `/dashboard` 入口保持为 Overview。

## 页面布局

### Global Header

- 左侧显示 Web Analytics 产品标识。
- Analytics 和 Settings 作为清晰的一级导航，当前页面具有明显的选中态。
- Header 不放置日期、维度等分析筛选控件。
- Settings 保持独立一级入口，不放进 Analytics Sidebar。

### Analytics 页面

- 桌面布局使用左侧固定宽度 Sidebar 和右侧主内容区。
- 内容区顶部显示当前报表标题和简短说明。
- Site、From、To 构成共享筛选栏，Apply 操作清晰可见。
- Dimension 仅在 Dimensions 报表显示；Definition revision 仅在 Conversions / Funnels 等支持定义版本的报表显示。
- 报表内容按主题和优先级排列，使用一致的标题、卡片、表格和间距。Overview 保留摘要，不再重复渲染所有 capability 报表的完整内容。
- 小屏时 Sidebar 收为可访问的抽屉或报表选择控件；筛选栏换行，表格可横向滚动。

### Settings 页面

Settings 继续使用 Global Header，但不显示 Analytics Sidebar。Settings 的站点目录、onboarding、配置任务导航与权限流程以 [Site Onboarding and Settings Design](site-onboarding-settings-design.md) 为准。本方案提供共享视觉基础、页面骨架、表单组件和状态样式；在 Site Management API 就绪前不将静态站点列表固化为新 Shell 的数据接口。

## Capability 与可用状态

导航依据当前 capability contract 和 Dashboard 实际支持的报表面建立映射。新增能力需补充用户可读名称、所属分组、页面内容、空数据状态、不可用状态和必要筛选器。

- 对已实现且当前有数据的报表正常展示内容。
- 已实现但没有数据时展示空状态，并保留时间范围和站点上下文。
- 站点配置关闭或依赖未满足时，明确显示不可用原因，并链接到 Settings；不把它伪装成空数据。
- 依赖 deployment definitions 的 Conversions / Funnels，应说明需要配置相应定义。
- Geo 不可用时显示配置或数据提供方相关提示，不暗示已有国家数据。
- 不支持独立用户报表面的内部基础能力（例如 `browser_context`）不单独创建 Sidebar 项。
- 未实现的未来能力不显示为可用页面；若产品决定提前展示占位入口，需明确标注为规划中且不可误认为已有数据。

Capability 的启用状态来源仍是现有配置服务与 contract，不由 Sidebar 本地状态定义。菜单可扩展，但不能替代后端 API 和处理能力。

## UI 技术基础

- Tailwind CSS 管理布局、响应式规则和常规样式。
- shadcn/ui 组件作为项目内可维护源码，统一 Button、Input、Select、Card、Table、Badge、Alert 等视觉和交互基础。
- Dashboard 页面和业务组件通过 `components/ui/` 使用项目内 shadcn 风格源码组件；原生交互标签仅允许出现在这些基础组件实现中，ESLint 会阻止页面和业务组件直接写裸控件。表格由共享组件包裹横向滚动区域，日期筛选使用 Date Picker 组件，危险和丢弃草稿确认使用 Alert Dialog。
- 全局样式只保留 Tailwind 导入、主题 token、基础 reset 和少量全局规则；避免继续扩展全局语义类名样式表。
- 统一颜色、字体、边框、圆角、阴影、间距和 focus ring token；默认采用浅色、中性背景和克制的蓝色强调。
- 表单和导航保留语义化 HTML、键盘操作、可见焦点、label 关联和 screen reader 状态。
- Server Component 继续承担页面数据读取；仅确有交互需要的控件使用 Client Component。

## 分阶段实施

总规划中的 M7a 可在 M0a 后与后端模块隔离和站点 API 开发并行；M7b 的 Analytics 报表页面迁移只依赖现有查询 API；M7c 的 Settings 重组依赖动态 Site Registry 与 onboarding API。以下步骤只描述 UI 内部顺序，不重复定义站点管理业务流程。

1. **M7a 基础样式与组件**：配置 Tailwind 和 shadcn/ui，建立主题 token、通用控件与页面容器。
2. **M7a 应用 Shell**：实现 Global Header、Analytics / Settings 一级导航、响应式 Analytics Sidebar 和 active state；站点选择通过可替换的数据入口读取，过渡期可接现有列表，但不把环境变量写进 Shell 组件。
3. **M7c Settings 页面**：在动态 Site Registry 和 onboarding API 完成后，按站点管理任务组织 Overview、Capabilities、Environments & Origins、Ingest Keys、Definitions；M7c.1–M7c.6 已交付并完成自动化 closeout。Firefox + Orca 实际播报复核作为非阻塞后续项记录在 M7c Settings Checklist。
4. **M7b Analytics 页面**：M7b.1 已交付 `/dashboard` Overview 与 Pages、Dimensions、Visitors、Sessions、Custom events、Web Vitals、Countries、Conversions、Funnels 独立路由；M7b.2 完成共享筛选器及 URL 上下文；M7b.3 完成报表加载、空数据、不可用、缺少 definitions 和 API 错误状态区分，并提供对应 Settings 入口。M7b.5 覆盖审查确认现有 Dashboard 单测覆盖导航/路由、URL 参数、报表筛选器和状态；记录的 Dashboard 单测（42 files / 213 tests）、类型检查、`pnpm check`、构建和格式检查通过。Dashboard E2E 未执行；按决定，M7b.4 的响应式、键盘和 Firefox + Orca 产品验收及 M7b.5 的 Dashboard E2E 关闭条件统一延后到 M10 完整产品验收。M7b 保持开放，验收通过后再关闭；详见 M7b checklist 和路线图 M10。
5. **视觉验收**：统一 loading、empty、error、disabled/unavailable 状态，验证窄屏、键盘导航、表格溢出和现有业务测试。Dashboard 测试、项目检查、构建、格式检查及两条浏览器 E2E 均通过；Runtime status 已补充原子化 live status 语义，并验证刷新后状态能更新到已挂载的编辑器；一次性密钥提示也已与密钥明文分开，避免创建时自动朗读密钥。M7c.6 已完成；Firefox + Orca 实际播报复核作为非阻塞后续项记录在 M7c Settings Checklist。

每阶段都应保持 Dashboard 可构建、可访问；不需要一次性重写数据层。

## 非目标

- 新增或改变 Analytics API、事件协议、processor 语义或 capability contract。
- 通过 UI 提前暴露后端尚未实现的数据能力。
- 改变 capability 配置和 ingest security policy 的权限模型。
- 在本次改版中强制引入图表、暗色模式或新的 analytics 指标。

## 验收标准

- Analytics 和 Settings 一级导航位于统一 Header，当前导航状态明确。
- Analytics Sidebar 可到达每个当前支持的用户报表页面，且不把内部基础 capability 重复呈现。
- Analytics 概览不再与所有完整报表混排；每页标题、全局筛选和上下文清楚。
- site、date range、dimension 和 definition revision 在切换报表时按各自适用范围保留或显示。
- no data、disabled、missing definitions、API error 和 loading 状态可区分。
- Dashboard 全部主要控件使用统一 Tailwind/shadcn 视觉基础并支持键盘和窄屏操作。
- 现有业务/API 测试保持通过；新增导航、筛选参数和状态显示测试。

## M7a shadcn/ui 重新验收

- 本次范围：迁移 Analytics、Settings、Site onboarding、加载/错误反馈及报表表格中的按钮、输入、选择、复选框和表格基础控件；新增 Alert Dialog 确认、组件路径别名和禁止业务 JSX 直接使用原生交互标签的 lint 规则。
- 约束：不更改 API、Event Protocol 或业务语义；`components/ui/` 源码可使用语义化原生 HTML。
- 验收（2026-10-04）：Dashboard typecheck、lint、单测（43 files / 214 tests）、构建、格式检查，`pnpm check`、`pnpm test`、`pnpm build`、`pnpm format:check:docs`、`git diff --check` 均通过。Dashboard 浏览器 E2E 与 Site onboarding E2E 通过；Dashboard E2E 覆盖报表、筛选与历史导航、键盘导航、响应式状态、Settings 配置、一次性密钥、Alert Dialog 撤销、定义冲突恢复及 API 错误状态。E2E 使用隔离的 Compose 项目和备用宿主端口，未更改已有开发服务。
- M7b 仍按 M10 完整产品验收计划开放；本次 Dashboard E2E 回归通过不替代待完成的 M7b.4 手工辅助技术验收。
