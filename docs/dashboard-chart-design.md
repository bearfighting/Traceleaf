# Dashboard 图表设计

## 状态与目标

- 状态：图表已实施；部分图表与验收项仍待完成
- 日期：2026-10-14
- 目标：为现有 Analytics Dashboard 增加能帮助识别趋势、比较排行和理解构成的图表，同时保留精确数据表和现有报表状态处理。

本文记录图表设计、实现状态和剩余验收项。图表复用 Analytics API 数据；Conversions 保留受 limit 约束的明细 `items`，并使用 `chart_items` 提供完整的逐日绘图序列。Custom Events 排行图待 API 契约另行支持。未完成的响应式和辅助技术检查仍明确列为待办。

## 当前基线

Dashboard 已有 Overview、Pages、Visitors、Sessions、Dimensions、Custom Events、Countries、Web Vitals、Conversions 和 Funnels 报表。趋势与分布类报表已加入图表，并保留相应精确数据表；Custom Events 目前保留逐日明细表。相关数据类型集中在 `apps/dashboard/lib/analytics/analytics-api/types.ts`，展示组件在 `apps/dashboard/components/analytics/`。

当前 Overview 有站点累计 Page Views 和选定日期范围 Page Views 卡片，并请求 Timeline API 展示每日趋势。Visitors 与 Sessions API 有每日序列和范围汇总；维度、页面、国家、Vitals、Conversions、Funnels 也各有自己的响应类型。Custom Events 仍只使用现有逐日明细响应。

日期趋势遵循 UTC 日历：当选定范围内至少有一条有效观测时，Page Views Timeline 和 Visitors/Sessions 日序列为范围内每个日期返回一行；没有事实记录的日期对应计数为 0。Conversions 对范围内出现过转换事件的定义补齐每日行；无转换但有 eligible sessions 时 rate 为 0，eligible sessions 为 0 时 rate 不可计算。整个范围没有相应报表事实时仍返回空序列，以保留报表空状态。分类分布图没有固定日期轴，不补造未知类别；Funnels 按实际 cohort 日期分组展示。

## 产品原则

1. 图表回答趋势、排行或构成问题；表格保留精确值、长尾分类和查找能力。
2. 同一图表只比较可比的指标。不同单位或不同统计口径不共享数值轴。
3. 不从页面端重新推导 API 没有承诺的指标。特别是不能把每日独立访客简单求和，作为日期范围的独立访客数。
4. 图表遵循现有日期范围、站点、环境和维度选择；图表与表格使用相同请求结果和日期区间。
5. 加载、空数据、禁用、不可用、错误及数据新鲜度状态沿用现有 report state 模式；不能只在表格区域处理这些状态。
6. 图表不替代数据表或文字摘要。颜色不能成为区分系列的唯一方式；图表需支持键盘/辅助技术使用，并提供可读的精确数据。
7. 避免为装饰而增加图表。Overview 先显示一张主趋势图；详细报表按数据需要增加一种主要图形。

## 图表库与组件方案

实现使用 **Recharts + 本地 shadcn 风格 Chart 组件**。

- Dashboard 已安装并锁定 Recharts 3.10.1，图表共享组件位于 `apps/dashboard/components/ui/chart.tsx`。
- 本地共享组件提供 `ChartContainer`、tooltip、legend 和网格线；各图表直接组合 Recharts 原语。
- Recharts 提供本设计所需的折线、柱状、堆叠条形、饼/环形图和自定义 tooltip。以直接组合 Recharts 原语为主，不建立一层隐藏 Recharts 行为的图表 DSL。
- Tailwind CSS 负责容器布局、响应式高度、间距和断点；dashboard 主题 CSS 变量负责文字、网格线、背景和系列颜色；Recharts 负责图形、轴、交互和 tooltip。
- Recharts 已在当前 Next.js、React 和 Tailwind 组合下通过 Dashboard 生产构建；后续升级这些依赖时应重新验证兼容性。
- 所有使用图表组件的文件应遵循 Next.js 当前版本的 Client Component 要求；只把真正需要浏览器绘制/交互的图表边界标记为客户端组件，数据加载仍留在现有服务端报表流程中。

参考： [shadcn Chart 组件文档](https://ui.shadcn.com/docs/components/base/chart)。文档说明该组件使用 Recharts v3，并推荐为响应式 `ChartContainer` 设置高度或最小高度。

## 指标与图表设计

| 报表/指标           | 主要图形                                                                                    | 数据与呈现要求                                                                                                                                                                                                                         | 保留的表格/信息                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Overview Page Views | 按日折线图；日期点少或区间短时也可使用柱状图，整个产品保持一致                              | 使用 Timeline API 的 `day`、`page_views`；日期按 UTC 显示；有数据范围内补全无记录日为 0；整个范围无数据则保持空序列                                                                                                                    | 当前两个 Page Views 汇总卡片；tooltip 展示日期和精确 Page Views；Timeline 报表保留每日表格                             |
| Visitors / Sessions | 双折线图                                                                                    | 使用每日 `unique_visitors`、`sessions`；图例清楚标识系列；趋势只表达每日值                                                                                                                                                             | 当前范围汇总数值；表格；说明每日 Visitors 不能求和为范围内 unique visitor 总数                                         |
| Pages               | 水平条形图，默认 Top 10                                                                     | 使用 `path` 和 `page_views`，按 API 排名；路径长时截断轴标签但 tooltip 显示完整路径                                                                                                                                                    | 完整 API 返回列表的表格和精确数值                                                                                      |
| Dimensions          | 水平条形图；可选 100% 堆叠条形图显示少数值的 Page View 占比                                 | 展示当前所选维度的一项指标；默认按 Page Views。若加入 Visitors 或 Sessions 切换，应明确每种值的排序与口径                                                                                                                              | 显示 `value`、Page Views、Unique Visitors、Sessions 的表格。Visitors/Sessions 比例必须按其自身有效分母计算，并提示口径 |
| Countries           | 水平条形图，默认 Top 10                                                                     | 使用 `country_code`、`page_views`；coverage、provider、freshness 说明与图表同区展示；Unknown 保持为明确类别                                                                                                                            | 完整国家表格；地理数据覆盖起点和来源说明                                                                               |
| Custom Events       | 暂不绘制排行榜；后续可在 API 契约支持完整区间聚合后增加                                     | 现有 API 返回受行数限制的逐日明细，前端不能据此可靠计算区间排行榜；不能将截断明细求和后冒充完整事件总数                                                                                                                                | 保留逐日事件表格及 API `total` 语义                                                                                    |
| Web Vitals          | 每项 Web Vital 的分布条形图，展示 Good / Needs improvement / Poor；可用点图或条形图呈现 p75 | 不同指标分图或分面，不能混用毫秒和 CLS 数值轴；显示样本数；`insufficient_data` 不绘制虚构值；阈值标注须与 Processor / API 契约一致                                                                                                     | 按 route 和 metric 的 p75、count、分类样本数表格；对不足样本明确说明                                                   |
| Conversions         | 每个 definition 的每日 conversion rate 折线图                                               | 用 `conversion_rate` 与 `day`；rate 的分母是 `eligible_sessions`，无转换事件但有 eligible sessions 的日期显示为 0，分母为 0 时保持不可计算；tooltip 同时给出 `converted_sessions` 和 `eligible_sessions`；不可跨 definition 混成一条线 | definition、每日转换次数、符合条件 sessions、rate 的表格；definition version 信息                                      |
| Funnels             | 按步骤递减的水平条形图或漏斗图                                                              | 使用同一个 definition 与日期的 `step_index`、`sessions`、`conversion_rate`；步骤标签取自 definition；tooltip 显示 sessions 和相对转化率。图中避免把步骤人数差异误称为严格的用户流失，除非契约保证同一 cohort                           | 每日/definition/step 的数值表格和定义版本；若步骤名缺失则使用明确的步骤编号                                            |

### 饼图与占比

饼图/环形图不作为默认方案。只有当分类互斥、合计有清楚含义、类别不超过约 5 项且用户确实需要看构成时才考虑使用；其余类别应合并为 “Other”，Unknown 单独处理。比较接近的比例用条形图比扇区更容易判断。若图表只展示 Top N，不能把 Top N 各项误标为全部数据的 100% 构成。

## 页面布局与交互

### Overview

1. 保留 Page Views、Unique Visitors、Sessions 汇总卡片及现有 Freshness 提示。
2. 在汇总卡片之后、Explore reports 导航之前增加 Page Views by day 趋势卡片。
3. 趋势图与当前站点、日期范围、环境使用同一上下文。切换日期范围后通过现有页面查询流程刷新。
4. 图表下方提供数据表或可展开/同屏的每日数值表，保证不用 hover 也能读取精确值。

### 详细报表

1. 趋势型报表将图表置于表格之前，保留表格作为明细。
2. 分布型报表显示排序图表与完整表格；类别过多时图表仅显示 Top N，说明截取规则。
3. 维度报告的图表需要跟随当前 dimension selector；切换维度后标题、系列、排序和表格保持一致。
4. 图表卡片复用 `.card` / `.report-card` 的既有视觉规则，避免另起一套页面框架。

### 响应式与可访问性

- 宽度随容器变化；图表容器需有明确高度或 `min-height`，避免首次渲染高度为零。
- 窄屏减少坐标刻度密度；长路径/类别名通过 tooltip 或换行显示。
- 设置有意义的标题、图例、轴标签和单位；毫秒、百分比、数量使用明确格式。
- 使用 Recharts accessibility layer（适用图形）；检查键盘导航和屏幕阅读器可读内容。
- 图表使用主题 token 定义颜色，确保对比度；系列需同时使用名称/标记，不依赖颜色单独传意。
- Tooltip 不承载唯一信息来源；对应表格或文字摘要应能访问图表中的精确值。

## 数据加载与边界

- Overview 增加 Timeline 请求，沿用现有 Analytics API client、请求错误映射、日期范围和站点上下文。避免同时从客户端重复请求同一图表数据。
- 各图表复用对应报表已经加载的响应，不增加为绘图而重复的 API 调用。
- 图表数据适配函数应为纯函数，处理排序、Top N、格式化及缺失值；不改变领域指标含义。
- 按日期聚合的计数序列必须包含范围内的无记录日期并显示 0；比例值在分母为 0 时仍应显示为不可计算，而不是 0%。
- 零值、无数据、缺失值应区分：零代表有有效观测且值为 0；空数据使用 Empty State；不足样本按 API 状态显示，不强行插补。
- 图表与表格必须展示相同日期范围、时区和筛选上下文。当前每日 Timeline 明确为 UTC。
- Freshness 为 stale、rebuilding 或 failed 时，现有提示必须仍然可见；不能用图表视觉样式掩盖数据过期状态。
- 页面数据加载失败、报表禁用或 API 不可用时继续展示现有 Error / Disabled / Unavailable State，不能留下空白图表框。

## 分批实施 Checklist

### A. 接入与通用基础

- [x] 确认 Recharts 版本与当前 Next.js、React、Tailwind 兼容，并记录锁定版本。
- [x] 使用本地 shadcn 风格 Chart 组件接入图表所需源码和 Recharts 依赖。
- [x] 在 Dashboard 主题中定义语义化图表颜色 token；当前 Dashboard 使用浅色主题。
- [x] 共享图表容器、可读名称、空数据状态和表格精确值访问方式已接入。
- [x] 图表为 Client Component，Analytics API 请求保留在服务端报表流程。
- [x] Recharts 与协议阈值依赖仅添加到 Dashboard 所需 workspace package。

### B. Overview Page Views 趋势

- [x] 扩展 Overview 数据加载，获取选定日期范围的 Timeline 响应。
- [x] 为 Overview Timeline 增加图表卡片，按 UTC 日期展示 Page Views。
- [x] 确保 Overview 的图表与汇总卡片使用相同 site/date/environment 上下文。
- [x] 增加图表数据适配单元测试，覆盖 API 顺序、空数组、零值、日期展示和精确值。
- [ ] 为空数据、API 禁用、不可用、网络错误和加载状态增加 UI 验证。
- [x] 提供无需 hover 的可读每日数据表或等价数据摘要。

### C. Visitors 与 Sessions 趋势

- [x] Visitors、Sessions 独立报表增加每日折线图，并按报表聚焦对应系列。
- [x] 在 Visitors 说明中声明每日独立访客不可累加为范围独立访客。
- [x] 表格与图表使用相同响应、日期顺序和过滤规则。

### D. Pages、Dimensions、Countries 分布

- [x] Pages 增加 Top 10 Page Views 水平条形图，长路径轴标签截断，tooltip 展示完整路径。
- [x] Dimensions 增加当前维度值的排序图表，默认展示 Page Views；本批不增加指标切换。
- [x] Countries 增加 Top 10 国家 Page Views 条形图，保留 Unknown 与 coverage 说明。
- [x] 明确并测试 Countries 按 API 排名截取前 10 项，Unknown 仅在前 10 项内显示；Dimensions 保留 API 顺序及零值。
- [x] 确保图表显示范围与表格明细范围有清楚说明；图表数据表继续展示完整 API 响应。

### E. Custom Events、Web Vitals、Conversions、Funnels

- [ ] 暂不增加 Custom Events 区间排行榜；现有 API 逐日明细有行数限制，完整聚合需先扩展 API 契约并单独验收。
- [x] Web Vitals 按 LCP、INP、CLS、FCP、TTFB 分组展示评级计数堆叠条和可用 p75 条形图；CLS 不显示毫秒单位，不足样本不绘制 p75。
- [x] Web Vitals p75 Good 与 Needs improvement 参考线使用 `@web-analytics/protocol-ts` 的共享评级阈值。
- [x] Conversions 按 definition 显示每日转化率，并在 tooltip 同时展示分子和分母。
- [x] Funnels 按 definition 与 cohort 日期分组，以离散步骤条形图显示 API 返回的 sessions；tooltip 展示 sessions 和原始 conversion rate，缺失步骤不插补，标签使用 definition 步骤名称或步骤编号回退。
- [ ] 对低样本、不足数据、零分母、缺失 definition 和 definition version 变化的验收，见下方“后续统一验收清单”。

### F. 质量与验收

- [x] 为本批趋势图和 Pages Top 10 增加组件测试，覆盖指标字段、API 顺序、零值与 Top 10 截取。
- [x] 为 Dimensions 与 Countries 增加图表测试，覆盖指标字段、API 顺序、零值、Top 10、Unknown 规则与完整表格。
- [x] Web Vitals 报表测试覆盖有数据、无数据、错误、禁用、不可用与非 current freshness，并保留表格精确数值。
- [ ] 剩余状态、视觉、辅助技术和端到端验收统一记录在下方“后续统一验收清单”。
- [x] 更新 Dashboard 图表设计文档和本设计 checklist 的实现状态。

## 后续统一验收清单

以下清单合并本轮及此前图表 review 中仍未完成的同类验收项，作为后续完成工作的唯一待办列表。已经修复的图表角色、Conversion 系列键冲突、Conversion/Funnel 请求上限和串行定义加载不列为待办。

- [ ] **状态与边界数据：** 为各报表验证有数据、空数据、错误、禁用/不可用及 freshness 非 current 状态；重点覆盖 Conversion/Funnel 的零分母、低样本、稀疏 Funnel 步骤、缺失 definition 和 definition version 不匹配。
- [ ] **响应式与可读性：** 在桌面和窄屏检查图表宽高、轴标签截断、长类别名、tooltip、图例、卡片溢出及 Web Vitals 多 route 高度。
- [ ] **辅助技术：** 用键盘和屏幕阅读器验证图表组名称、Recharts 键盘交互及焦点顺序；确认所有图表的精确值不依赖 hover，系列区分不只依赖颜色。
- [ ] **颜色对比：** 在实际图表背景上检查固定主题色和 Conversion 动态色；当前已加深第三主题色和动态色，但尚未完成全图表视觉验收。
- [ ] **数据一致性与 E2E：** 使用真实 Analytics API 响应验证图表、表格的日期/筛选上下文和指标值一致，并覆盖 Conversion/Funnel definition/cohort 标签。
- [ ] **项目验证：** 运行 Dashboard 格式检查、lint、类型检查、相关测试、Dashboard E2E 和项目统一脚本中的适用检查；根据结果更新本清单。

Custom Events 区间排行榜依赖 API 提供完整区间聚合，属于单独的 API 能力待办；在此之前保留逐日表格，不从可能截断的明细推导排行榜。
