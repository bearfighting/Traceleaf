# Traceleaf 品牌统一与 Logo 接入方案

## 状态与目标

- 状态：已完成
- 更新日期：2026-10-17
- 范围：统一项目面向用户的产品名称，并将已评审方向的 Traceleaf Logo 接入 Website 与 Dashboard
- 目标：让访客从项目 README、Website、Dashboard 和浏览器标签中看到同一产品品牌，同时保留清晰的功能说明

本文件记录实施范围、品牌规则和验收结果。已评审的 refined 资产已逐份复制到 Website 与 Dashboard 的 `public/brand/`，并接入两个应用的导航、浏览器图标与 Apple touch icon。原始概念目录按维护者要求在验收后删除；两个应用中的副本需同步维护。

## 品牌命名规则

- 唯一产品与项目品牌名：**Traceleaf**。
- 英文功能副标题：**Self-hosted web analytics**。
- 中文功能副标题：**自托管网站分析**。
- 英文扩展说明：**Web analytics for developers who want control over their data and infrastructure.**
- 中文扩展说明：**面向开发者的自托管网站分析，让数据和基础设施保持在自己的掌控之中。**
- Logo 字标使用 `traceleaf` 小写形式，以匹配当前概念稿；正文、标题、可访问名称和文档中品牌名使用 `Traceleaf`。
- “Website”“Dashboard”“Analytics”“Settings”等词继续描述应用入口或功能，不作为独立产品品牌。

建议组合：

```text
Traceleaf
Self-hosted web analytics
```

中文页面组合：

```text
Traceleaf
自托管网站分析
```

导航空间有限时只显示 Logo，不强制在 Logo 旁显示副标题。较长扩展说明用于 Website 首页与适当的介绍文案，不放入 Dashboard 顶栏。

## 实施前差距

| 位置               | 当前表现                                                  | 目标                                                                            |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 仓库 `README.md`   | 标题为 `Web Analytics Platform`                           | 标题与产品介绍统一为 Traceleaf，并采用明确的功能描述                            |
| Website 顶栏       | 手写叶片 SVG 加 `Traceleaf` 文字                          | 使用统一横版 Logo，保留现有首页链接和响应式导航                                 |
| Website 页脚       | 只有 Traceleaf 文字                                       | 使用统一横版 Logo 或适合页脚尺寸的符号与字标组合                                |
| Website metadata   | 已包含 Traceleaf 与网站分析描述                           | 补齐中英文一致的品牌、描述与图标 metadata                                       |
| Dashboard 顶栏     | `W` 字母标记、`Web Analytics` 和 `Platform`               | 使用 Traceleaf Logo；Analytics 与 Settings 保持为功能导航                       |
| Dashboard metadata | `Analytics Dashboard`、`Web Analytics Platform Dashboard` | 使用 `Traceleaf Dashboard` 与准确的 Dashboard 描述                              |
| favicon / app 图标 | Website 与 Dashboard 曾使用 app-icon 构图作为通用图标     | 两个应用使用一致的 Traceleaf favicon 和 app icon；不声明尚未实现的 PWA manifest |
| Dashboard 测试断言 | 断言旧品牌文案 `Web Analytics`                            | 更新为 Traceleaf 的可访问名称和品牌表现                                         |

## 视觉资产与适配

品牌选定基于 `traceleaf_logo_concepts/refined/`。该目录已删除，完整设计文件副本分别保存在 `apps/website/public/brand/` 和 `apps/dashboard/public/brand/`：

- `traceleaf-symbol.svg`：独立符号，适合紧凑导航等空间。
- `traceleaf-favicon.svg`：带深色圆角底板的紧凑 favicon 构图。
- `traceleaf-app-icon.svg`：180 × 180 app 图标构图。
- 所有 PNG 文件（包含 16、32、64、180 像素预览和浅色/深色横版评审图）也分别保存在两个应用中。

Next.js 要求每个应用在各自目录中提供图标入口，因此两个应用保留逐字节相同的品牌副本。导航从各自 `public/traceleaf-symbol.svg` 读取符号；`app/icon.svg` 使用 refined favicon；`app/apple-icon.png` 使用 180 像素 app icon。`public/brand/` 留存完整设计包，改动图形时两个目录与 Next.js 图标入口必须一起更新。

应用中的横版 Logo 由共享符号与小写 `traceleaf` HTML 字标组合，使用应用字体样式，不依赖 Inter 是否安装。共享符号采用同一 SVG 源，渐变和节点颜色需在浅色与深色表面保持足够对比。小尺寸 favicon 要在 16 × 16 与 32 × 32 实际核对；深色 tile 与 app icon 的圆角构图不得误用于横版 Logo。

## 改动范围

### Website

- 更新 `apps/website/components/site-header.tsx`：用正式横版 Logo 替换现有 `TraceleafMark` 内嵌图形与单独文字；保留 locale 首页链接、导航、语言和主题控件。
- 更新 `apps/website/components/site-footer.tsx`：在页脚以合适尺寸呈现品牌 Logo，并保留简介、导航、GitHub 链接和版权信息。
- 更新 `apps/website/app/layout.tsx` 与 `apps/website/app/zh-cn/layout.tsx`：统一 metadata 标题、描述及图标定义，英文与简体中文语义一致。
- 校准 Website 浅色和深色主题下 Logo 对比度、导航尺寸和窄屏布局。
- 视需要微调首页既有品牌介绍，使短副标题和扩展说明语义一致；不借此重写产品文案或新增未经验证的产品声明。

### Dashboard

- 更新 `apps/dashboard/components/shared/dashboard-shell.tsx` 中的 `DashboardHeader`：替换 `W` 与 `Web Analytics / Platform`，以 Traceleaf 为品牌；Analytics、Settings、Add a Site 仍是功能入口。
- 更新 `apps/dashboard/app/layout.tsx`：title template 使用 `Traceleaf Dashboard`，description 清晰说明这是 Traceleaf 的网站分析面板。
- 为 Dashboard 配置与 Website 一致的 favicon 和 Apple touch icon；PWA manifest 不在本次范围内。
- 更新 `apps/dashboard/components/shared/dashboard-shell.test.tsx` 中依赖旧品牌的期望，并检查相关顶栏可访问名称。
- 检查顶栏在窄屏、长页面标题和现有 Dashboard 配色下的布局与对比度。

### 项目入口文档

- 更新仓库根目录 `README.md` 标题与开篇介绍，以 Traceleaf 为项目名，以 Self-hosted web analytics / 自托管网站分析说明用途。
- `apps/website/README.md` 已以 Traceleaf 命名，只在确认其描述与最终命名规则不一致时调整。
- 只统一面向用户的品牌名称；代码包名、workspace scope、数据库对象、API 标题、镜像名、环境变量和历史文档不在本次自动改名范围内。技术名称若确有独立迁移需求，应另立范围并评估兼容性。

## 实施步骤 Checklist

### 1. 确认并准备品牌资产

- [x] 以 refined 资产为准确定共享符号、favicon 和 app icon 源；横版组合使用共享符号与 HTML/CSS 字标。
- [x] 确定应用字标使用小写 `traceleaf`，沿用应用字体样式，不依赖 SVG 内嵌文字或本机安装 Inter。
- [x] 在 16、32、64、180 像素预览中检查清晰度，并检查共享符号在浅色、深色表面上的对比度与边缘留白。
- [x] 将所有 refined 设计资源分别复制到两个应用的 `public/brand/`，记录副本同步规则。
- [x] 使用 refined SVG 配置两个应用的 favicon，并使用 180 像素 app icon 配置 Apple touch icon。

### 2. 接入 Website

- [x] 替换 Website 顶栏手写标记，使用统一 Logo。
- [x] 更新页脚品牌呈现。
- [x] 更新英文 metadata、简体中文 metadata 和图标 metadata。
- [x] 检查两个主题、所有 locale、移动导航、键盘焦点与 Logo 可访问名称。

### 3. 接入 Dashboard

- [x] 将顶栏品牌改为 Traceleaf Logo 与名称。
- [x] 保留 Analytics、Settings 与 Add a Site 作为功能导航。
- [x] 更新 Dashboard 标题模板、描述、图标和可访问名称。
- [x] 更新涉及旧品牌显示的 UI 测试断言。
- [x] 检查窄屏导航、图标对比度和页面布局。

### 4. 统一项目入口文字

- [x] 更新根 README 的项目标题和开篇描述。
- [x] 对照命名规则检查 Website 和 Dashboard 中面向用户的品牌文本。
- [x] 检索 Website、Dashboard、Collector CLI 和 Playground metadata 中的旧产品品牌文案；内部包名、协议标识和历史记录按兼容性规则保留。
- [x] 确认保留的 Analytics、Dashboard 等词是功能描述或技术名称，不是另一个产品品牌。

### 5. 验收与收尾

- [x] Website 英文和简体中文页面显示一致的 Traceleaf 品牌与对应副标题。
- [x] Dashboard 与 Website 使用同一品牌符号、favicon 和 app icon，品牌名称均为 Traceleaf。
- [x] 浅色/深色主题、桌面/窄屏和 16/32 像素 favicon 均清晰可辨。
- [x] 页面标题、favicon、页头、页脚和 Dashboard 顶栏没有互相冲突的产品名称。
- [x] 两个应用的格式检查、lint、类型检查、相关测试和生产构建通过；Website 浏览器验收通过。
- [x] 完成本计划、实施日期、验收命令与结果记录。

## 验收标准

- 面向用户的项目与产品品牌统一为 Traceleaf；不会在 Website 或 Dashboard 顶栏继续把 Web Analytics Platform 当作产品名。
- 功能副标题在英文和简体中文中分别使用 `Self-hosted web analytics` 与 `自托管网站分析`，表达一致。
- Website 与 Dashboard 使用同一符号源和 favicon/app icon 源；横版字标由符号与小写品牌名组合，浅色和深色资源均已保留。
- Logo 不挤压导航、不影响语言切换、主题切换、Dashboard 功能导航或移动端操作。
- 页面 metadata、可访问名称和视觉显示一致；Logo 不只依赖颜色传递品牌信息。
- 根 README 与应用内品牌介绍使用同一名称和产品描述。
- 没有因视觉品牌统一而未经评估地更改包名、API、数据库、部署标识或兼容性契约。

## 验收记录

- 两端资源：`public/brand/` 中 9 个 refined 图形文件逐一复制；原始概念目录移除前后核对 SHA-256。`app/icon.svg` 使用 favicon SVG，`app/apple-icon.png` 使用 180 像素 app icon。
- Website：7 项单元测试、类型检查、lint、格式检查、生产构建通过；Playwright 8 项通过，覆盖中英文路由、页头/页脚、metadata、图标、窄屏和 hydration。
- Dashboard：304 项单元测试、类型检查、lint、生产构建通过；窄屏和导航测试包含在单测中。
- 其他展示入口：Collector CLI 品牌说明单测通过；Next.js Router Playground 类型检查和 lint 通过。仓库未配置 PWA manifest 或 service worker，因此只接入 Apple touch icon，不新增 PWA 功能。
- `git diff --check` 通过。workspace package scope、API、数据库和部署技术标识保留原样。

## 不在本次范围内

- 重命名 npm/pnpm workspace package、Rust crate、API operation、数据库 schema、Docker image、Compose service、环境变量或 GitHub 仓库。
- 重写所有历史 ADR、归档计划、发布记录与已发布版本文档中的历史名称。
- 改变 Website 或 Dashboard 的产品功能、信息架构、Analytics 指标语义和 Dashboard 图表主色。
- 引入新的图标、字体或图片处理依赖；只有现有工具无法满足导出需要时才单独评估依赖。
- 发布网站、发布新版本或更新外部服务中的品牌资料。
