# Website 产品预览与 Dashboard 一致性改进计划

## 状态与目标

- 状态：改进计划，尚未实施
- 日期：2026-10-14
- 范围：Website 首页和产品页复用的动画产品预览，以及预览相关的中英文文案和样式
- 目标：让访客在展示网站看到的指标语义、图表表达和产品视觉，与实际 Dashboard 一致；营销页面仍可保留自己的叙事结构和适度动画

本文是实施计划，不代表以下设计已经落地或验收。实际 Dashboard 的报表与口径以 [Dashboard 图表设计](dashboard-chart-design.md) 和当前代码为准。

## 设计原则

1. **先保证产品承诺准确。** 预览只展示 Dashboard 已实现且语义明确的指标，不展示尚无对应报表的指标或变化率。
2. **让预览看起来像真实产品。** 预览内部复用 Dashboard 的卡片、图表颜色、刻度、标签和间距规则；Website 外层布局继续承担营销介绍职责。
3. **示意数据也遵循真实数据结构。** 展示数据可以固定，不连接生产 API，但指标之间应自洽，字段、排序、单位和时间口径应模拟实际报表。
4. **动画服务于理解。** 动画表现图表和卡片的出现，不改变图表数据含义；暂停、重播和减少动态效果行为继续可用。
5. **精确数据不依赖动画或 hover。** 静态预览应有可读标签、数值和示例数据说明；实际 Dashboard 的表格仍是精确查阅入口。

## 当前实现与差距

展示预览位于 `apps/website/components/product-preview.tsx`，中英文文案位于 `apps/website/lib/content.ts`，样式位于 `apps/website/app/globals.css`。

| 项目            | Website 当前展示                                                     | Dashboard 当前实现                                                                                            | 需要调整                                                                                            |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| KPI 卡片        | Page Views、Visitors、Avg. visit duration，以及 `+12.8%` 等变化率    | Overview 展示 Site total Page Views 和 Selected range Page Views；Visitors 与 Sessions 在各自报表提供范围汇总 | 移除没有 Dashboard 对应报表的平均访问时长及变化率；预览首屏优先映射 Overview 的两个 Page Views 指标 |
| 访客称谓        | Visitors                                                             | Unique Visitors                                                                                               | 如预览展示访客报表，应使用 Unique Visitors，并表达所选日期范围口径                                  |
| Page Views 趋势 | 固定 SVG 曲线、Mon–Sun 标签、无日期及数值轴                          | Timeline API 的 UTC 日期序列，带日期轴、数值轴、tooltip 和无需 hover 的每日数据表                             | 让示意图模拟按日期趋势；使用明确日期刻度、数量刻度和相同指标命名                                    |
| Top Pages       | 三条绿色窄进度条，没有坐标轴                                         | API 排序的蓝色横向条形图，最多绘制前 10 项，并保留完整表格                                                    | 使用 Dashboard 蓝色系列和横向条形图表达；Website 可只取前三项作为空间受限的预览，并说明是示例       |
| 主题            | Website 绿色品牌，支持暗色                                           | Dashboard 使用蓝色品牌与浅色报表表面                                                                          | 产品预览内部采用 Dashboard 浅色视觉；外围 Website 仍可按网站主题显示                                |
| 示例说明        | 已标注固定示例数据                                                   | Dashboard 使用当前查询的 Analytics API 响应                                                                   | 保留示例说明，并避免让样例看起来像当前站点的实时数据                                                |
| 动画与可访问性  | 使用 Motion，支持暂停/重播和 `useReducedMotion`；趋势 SVG 有图像名称 | Recharts 图表并提供图表语义、tooltip 与数据表                                                                 | 保留现有行为；补充预览图的文本语义与键盘检查，避免只有视觉表达                                      |

Dashboard 的 Overview 当前只有两个 Page Views 汇总卡片；访客和会话汇总属于 Audience 报表。预览不可将 Unique Visitors 或 Sessions 伪装成 Overview KPI。如果展示这些指标，应明确它们来自访客/会话报表或将预览改为该报表的局部视图。

## 目标展示方案

### 方案：Overview 与 Top Pages 的精简产品快照

保持当前产品预览整体框架和动画节奏，将内容组织成一个 Dashboard Overview 快照：

1. **预览顶栏**：站点名称、当前报表名称、示例日期范围。采用 Dashboard 的浅色背景、边框、字重和圆角。
2. **Overview KPI**：展示 `Site total Page Views` 与 `Selected range Page Views` 两张卡片。中英文标签随文案 locale 翻译；数值明确为固定样例。
3. **Page Views by day**：一张按日期展示 Page Views 的趋势图。图表使用 Dashboard 的主蓝色、浅色网格线、数量 Y 轴和日期 X 轴。小尺寸预览可稀疏显示 X 轴刻度，但 tooltip 或旁侧数据标签应能识别日期与值。
4. **Top Pages**：一张紧凑横向条形图，仅展示示例数据中的前三个路径，使用 Dashboard 主蓝色。标题或辅助说明明确这是 Top Pages 的示例预览，不暗示只返回前三项。
5. **示例提示和动画控制**：继续在预览外显示固定示例数据提示；暂停、继续、重播按钮保留，并使用中英文文案。

页面空间不足时，优先保留两个 KPI、Page Views 趋势和 Top Pages 的排名/数值关系。不要为了塞进所有内容缩小到不可读，也不要把不属于 Overview 的访客指标硬塞入 Overview 卡片行。

### 可选的访客报告快照

如果产品展示需要突出 Visitors/Sessions，可以在后续单独增加一个 Audience 报表预览状态或轮播步骤：

- 使用 `Selected range Unique Visitors`、`Selected range Sessions` 等 Dashboard 用语。
- 时间序列明确说明按 UTC 日期；不能把每日 Unique Visitors 相加后冒充范围唯一访客总数。
- 必须标明该画面对应 Visitors / Sessions 报表，而不是 Overview。
- 本计划第一批不要求加入该第二个预览状态；Overview 与 Top Pages 对齐优先。

## 视觉对齐规范

### 预览内部

- 使用 Dashboard 主题的浅色 surface、前景、muted、border、radius 和主色图表 token。首批可以在 Website CSS 中定义明确命名的 `--preview-dashboard-*` token，值对齐 `apps/dashboard/styles/theme.css`，避免 Website 页面主题切换时意外让 Dashboard 预览变暗。
- 预览应在 Website 浅色与暗色页面主题下都保持 Dashboard 浅色报表外观；外部网站背景、文案、导航仍遵循 Website 当前主题。
- 采用 Dashboard 的蓝色 `chart-1` 表达 Page Views；网格线用低对比中性边线。不要继续用绿色趋势线、绿色条形作为图表主系列。
- 卡片使用 Dashboard 类似的白色表面、细边框、紧凑标题和数字层级。保留营销页面所需的外围阴影或光效时，不能让预览卡片本身显得像另一套分析产品。
- 在 Website 中局部镜像 Dashboard token 即可；不要让 Website 运行时依赖 Dashboard app 的 CSS 文件或构建产物。

### 动画

- 保留指标卡片轻微进入动画和图表线条绘制效果；限制动画时长与位移，避免动画掩盖数值。
- 动画停止后必须呈现完整图表与所有标签；暂停/重播只控制装饰性动效。
- `prefers-reduced-motion` 下不播放位移、绘制或循环动画，但内容和图表保持完整可见。
- 初始 HTML/静态渲染不能依赖动画完成才显示数值。动画重播不得造成按钮焦点丢失。

## 内容与示例数据规则

- 移除 `avgDuration` 文案及 `2m 14s` 示例，除非 Dashboard 后续增加了同一口径的实际报表。
- 移除 `+12.8%`、`+8.2%`、`+4.6%` 这类当前 Dashboard 未提供的比较值，避免隐含增长比较能力。
- Website 首页预览优先使用 Dashboard 当前真实标题：`Site total Page Views`、`Selected range Page Views`、`Page Views by day`、`Top Pages`。翻译应表达相同统计范围，不要只做字面替换。
- 示例趋势数据和总量应由一份结构化静态样例定义，不分别硬编码在 SVG path、图表标签和 KPI 文本里。样例日期、每日值、区间汇总保持一致；累计站点总量可高于所选范围总量。
- Top Pages 样例按 `page_views` 降序排列，数值与条长基于同一个样例数据集；截断为三项时注明它只是紧凑预览。
- 固定示例数据提示在中英文中保持显著且一致。不要在没有 API 支持的情况下称为实时数据、当前数据或增长趋势。

## 实施步骤

### 1. 统一预览内容模型

- 将目前分散的静态文字、图表路径、数值和宽度改为单一静态样例对象，结构接近 Timeline 与 Pages 的 Dashboard 数据字段。
- 通过确定性计算得到图表点位和 Top Pages 条宽；避免手绘曲线与标签值互不关联。
- 删除预览没有使用的平均访问时长和增长率中英文文案。

### 2. 调整组件结构

- 重构 `ProductPreview` 的 KPI 卡片以呈现两个 Overview Page Views 指标。
- 将趋势图转为可从样例点生成的 SVG 或轻量 SVG 图表，显示日期刻度、数值刻度和适当的网格线。
- 将 Top Pages 换成与 Dashboard 横向条形图接近的紧凑样式，保留完整路径名称可读能力（窄屏可换行或通过可访问名称读取）。
- 为图表和区域增加能准确描述内容的标题与 ARIA 名称；装饰性图形避免重复朗读。

### 3. 对齐 Dashboard 视觉 token

- 在 Website 样式中增加 preview 专属 Dashboard token，并对照 `apps/dashboard/styles/theme.css` 的浅色主题。
- 更新预览内部指标卡、趋势图、条形图和日期范围控件的背景、文字、边线、圆角和蓝色系列。
- 检查暗色 Website 下预览仍维持浅色 Dashboard 表面，并检查边界和文字对比。

### 4. 保留动画并覆盖交互边界

- 保留暂停、继续、重播和减少动态效果行为；动画只用于进入/绘制，不改变任何数字。
- 确保键盘可到达控制按钮，按钮有可读名称，焦点样式清晰。
- 图表有不依赖动画、颜色或 hover 的文本数值说明；实际精确数据的产品承诺继续由 Dashboard 表格承担。

### 5. 更新文案与产品声明

- 更新 `apps/website/lib/content.ts` 的英、中两套预览标签和示例说明。
- 检查首页及产品页引用同一个 `ProductPreview` 时，标签、样例和动画状态一致。
- 搜索 Website 是否仍有“平均访问时长”或未实现增长率的文案，避免预览修改后其他入口继续承诺。

## 验收标准

### 内容和指标

- [ ] Website 预览不再展示 Dashboard 尚未支持的平均访问时长或比较增长率。
- [ ] Overview KPI 与 Dashboard 指标名称和统计范围一致；访客指标若展示，使用 Unique Visitors，并归属到访客报表场景。
- [ ] 示例日期序列、每日 Page Views、范围汇总和 Top Pages 排序来自同一份静态数据，内部关系正确。
- [ ] 预览明确写明固定示例数据，不暗示实时 API 数据。
- [ ] 英文和简体中文的含义、范围、时间单位和示例说明一致。

### 视觉与布局

- [ ] 预览卡片、文本层级、边框、圆角、蓝色图表系列和网格线与 Dashboard 浅色报表风格接近。
- [ ] Website 外围仍能看出网站自身品牌，但预览内部不再用独立绿色图表系列。
- [ ] Website 暗色主题下 Dashboard 预览保持可读的浅色产品面板。
- [ ] 桌面与窄屏下 KPI、日期刻度、Top Pages 标签和示例提示无溢出或遮挡。

### 动画与辅助技术

- [ ] 暂停/继续和重播可用，动画结束/暂停时所有数值完整显示。
- [ ] `prefers-reduced-motion` 下不播放非必要动效，预览内容仍完整呈现。
- [ ] 键盘可访问暂停/继续和重播按钮，焦点样式可见且名称清楚。
- [ ] 图表名称和趋势/排行信息可通过辅助技术理解；重要日期与数值不只靠颜色或 hover 表达。

### 工程验证

- [ ] 增加针对样例数据适配的单元测试，覆盖日期与值一致、趋势点生成、Top Pages 排序和条长比例。
- [ ] 增加 Website 预览组件测试，覆盖中英文内容、无未支持指标、示例提示和控制可访问名称。
- [ ] 运行 Website 类型检查、lint、相关测试、格式检查和生产构建。
- [ ] 浏览器检查首页与产品页、浅色与暗色、桌面与窄屏、减少动态效果设置。

## 范围边界

- 不接入真实 Analytics API；展示网站继续使用显式标记的固定样例，避免为营销预览增加鉴权、数据刷新和 API 依赖。
- 不改变 Analytics API、响应结构、Dashboard 数据语义或 Dashboard 页面布局。
- 不要求 Website 整体改成 Dashboard；一致性要求作用于产品预览的内容和内部报表视觉。
- 若将来 Dashboard 增加新的指标或品牌 token，应更新本预览并重新核对指标范围和文案。

## 相关文件

- `apps/website/components/product-preview.tsx`
- `apps/website/lib/content.ts`
- `apps/website/app/globals.css`
- `apps/dashboard/styles/theme.css`
- `apps/dashboard/components/analytics/traffic-and-outcome-report-sections.tsx`
- `apps/dashboard/components/analytics/overview-page-views-chart.tsx`
- `apps/dashboard/components/analytics/top-pages-chart.tsx`
- `apps/dashboard/components/analytics/top-pages-table.tsx`
- `docs/dashboard-chart-design.md`
