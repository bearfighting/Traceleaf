# 代码重构候选清单

> 扫描日期：2026-10-06。统计来自工作区当前 Git 跟踪文件。物理行数按文件字节内容的换行行定义（Python `splitlines()`；末尾换行不额外增加一行），空行和注释均计入。阈值为严格大于 200 行。

## 扫描口径与汇总

- 纳入扩展名：`.css`、`.html`、`.mjs`、`.rs`、`.sh`、`.sql`、`.ts`、`.tsx`。未按目录排除；只处理 `git ls-files` 返回且工作区存在的文件。
- 缺失的跟踪文件单独统计，不以 Git 对象内容代替工作区文件；本次缺失数：0.
- 总计：381 个存在的跟踪文件；55043 行；75 个大文件候选。
- 按扩展名：`.css` 1；`.html` 2；`.mjs` 47；`.rs` 79；`.sh` 10；`.sql` 23；`.ts` 112；`.tsx` 107
- 按类别：生产实现 198；测试 94；生成代码 7；实验产物 7；迁移/fixture 23；构建/CI tooling 52

分类按路径、测试命名、生成目录/文件标记和 tooling 目录判断；分类不明确时不推断业务职责。生成代码、实验、迁移和 fixture 即使超过阈值也不作为生产实现拆分候选。

## 领域候选切片

以下说明职责和关联范围，行数只用于定位。依赖/调用关系为静态路径与模块边界层面的直接邻接；具体函数级调用图留待工作包 1.2。

### Dashboard：创建站点流程

- 主要文件：`apps/dashboard/components/site-creation-wizard.tsx` (620，生产实现)。持有向导输入、步骤/提交状态和错误反馈；输入为用户选择及站点创建依赖，输出为站点创建与能力初始化请求及页面状态。副作用为 API 请求和导航/交互反馈。
- 直接关联：`apps/dashboard/app/dashboard/sites/new/page.tsx` 是页面入口；`apps/dashboard/lib/site-management/client.ts` (414) 是站点 API 边界，配置/能力调用位于相关 site-management/configuration API 客户端；`site-creation-wizard.test.ts` (38)、`site-creation-wizard.ui.test.tsx` (278) 覆盖流程逻辑与 UI。
- 建议切片边界：向导状态/动作、纯输入与步骤规则、步骤视图、站点创建 API 调用及上述测试；保留页面入口和请求语义。

### Dashboard：定义、配置与密钥管理

- `definition-editor.tsx` (528) 负责定义编辑 UI 和流程状态；关联 `definition-editor.test.tsx` (243)、`apps/dashboard/lib/definition-revision-history.ts` (89) 及 analytics API client/queries。输入为站点/定义数据与用户编辑，输出为定义读写请求和反馈。
- `configuration-editor.tsx` (419) 管理配置编辑、初始化和保存视图；关联 `configuration-editor.test.tsx` (179)、`configuration-editor.initialize.ui.test.tsx` (92)、`apps/dashboard/lib/configuration-api/{server,proxy,types,errors}`。副作用由 server/proxy API 边界执行。
- `ingest-keys-manager.tsx` (452) 管理 key 列表与创建/撤销交互；关联 `ingest-keys-manager.test.tsx` (258) 及 `apps/dashboard/lib/site-management/client.ts`。敏感 key 显示和 API 响应是该流程状态。
- 这三个界面共享 settings 页面外壳和错误/加载状态组件，但 API、状态所有权和领域校验不同；按各自用户流程成组拆分，不先抽通用编辑器。

### Rust：Collector 与配置/API 服务

- Collector HTTP：`services/collector/src/http.rs` (1086) 编排路由、请求提取、验证/策略和 sink 写入；输入为 HTTP 请求，输出为响应及持久化/限流副作用。直接邻接模块包括 `protocol.rs`、`validation.rs`、`runtime_policy.rs`、`security.rs`、`rate_limit.rs`、`sink.rs`；相关集成测试 `tests/http_ingestion.rs` (411)、`tests/postgres_storage.rs` (517)。
- Collector policy：`runtime_policy.rs` (743) 加载/执行运行时站点策略；关联 `config.rs` (464)、`security.rs` (235)、`rate_limit.rs` (112)、`tests/runtime_policy_postgres.rs` (419) 与 HTTP 集成测试。数据库/时间状态及策略决策副作用需在工作包 1.2 核对。
- Analytics API site configuration：`site_management/configuration.rs` (1082) 与 `config_store.rs` (1031)，分别承载配置请求/应用流程与持久化读写；调用入口为 `site_management/routes.rs` / `mod.rs`，关联 `validation.rs` (119)、`state.rs` (25)、`errors.rs` (128)、`site_store.rs` (174) 和 `services/analytics-api/tests/http.rs` (2420)、`module_boundaries.rs` (452)。
- `crates/configuration-runtime/src/lib.rs` (604) 是 runtime crate 入口及公开 API 聚合；实现关联 `registry.rs` (360)、`views.rs` (126) 及 crate 单元测试。切片应保持入口导出稳定，先明确模块私有边界。

### Rust：Processor

- `services/processor/src/processor.rs` (1805) 组织解析/规范化、会话化、维度与聚合处理及写入/rebuild 路径；输入为 raw events 与定义/能力，输出为分析事实数据。副作用为数据库事务和聚合写入。直接协作者：`parser.rs` (102)、`normalizer.rs` (123)、`sessionizer.rs` (169)、`definitions.rs` (314)、`queries.rs` (253)、`models.rs` (15)、`capabilities.rs` (19)。
- 关联测试：`services/processor/tests/processor.rs` (1340)、`canonical_fixtures.rs` (203)；需按真实处理顺序、共享状态和幂等/rebuild 语义划分，不按函数长度猜边界。

### E2E 与契约 tooling

- Dashboard suite `tests/e2e/suites/e2e-dashboard.mjs` (2033)：浏览器流程、造数、断言与诊断；关联 runner (`runner/cli.mjs` 214、`environment.mjs` 201、`suite-registry.mjs` 76、`runner.test.mjs` 71)、support 与 dashboard fixture。副作用包括 Compose/数据库、浏览器和清理。
- Analytics/configuration suites 分别为 `e2e-analytics.mjs` (609)、`e2e-configuration.mjs` (490)，关联各自 `e2e-site-management.mjs` (295)、`e2e-site-onboarding.mjs` (307) 及共享 runner/support。需先确认生命周期和造数归属。
- Contract tooling 大文件：`validate-analytics-api-contract.mjs` (716)、`validate-configuration-contract.mjs` (592)、`compare-contract-type-generators.mjs` (379)、`validate-http-fixtures.mjs` (333)。入口输入为 schema/fixture/type 源，输出为诊断和进程退出码；关联 tooling/contracts 的 protocol/capability/layout validators、生成器、parity checks 和 package scripts。

### 其他测试、样式与单独评估项

- `services/analytics-api/tests/http.rs` (2420) 是 API HTTP 行为集成测试，涉及多个路由/能力；按请求行为和 fixture 生命周期分组。
- `apps/dashboard/styles.css` (968) 为全局 CSS；关联 dashboard 全组件，拆分前需确认全局导入和 cascade 边界。
- `db/tests/test-migrations.sh` (866) 属迁移测试 tooling；`tools/site-registry-importer/src/lib.rs` (795) 与 `main.rs` (443) 是独立 importer 实现/CLI，可按导入流程评估。
- 生成物：`services/collector/src/generated/environment_policy.rs` (316)、`packages/protocol-ts/src/generated/*`、`experiments/m0b/generated/*`；改生成源/生成器，不直接重构生成输出。实验目录 `experiments/m0b/**` 按实验生命周期单独评估。迁移 SQL 保留历史文件不修改；大型 fixture 和 canonical fixture (`services/processor/tests/canonical_fixtures.rs`) 是测试数据/测试支撑，不计生产实现拆分规模。

## 完整文件索引

| 行数 | 类别            | 跟踪文件                                                                                              |
| ---: | --------------- | ----------------------------------------------------------------------------------------------------- |
|   27 | 生产实现        | `apps/dashboard/app/api/admin/sites/[siteId]/capabilities/route.ts`                                   |
|   27 | 生产实现        | `apps/dashboard/app/api/admin/sites/[siteId]/conversion-funnel-definitions/route.ts`                  |
|   10 | 生产实现        | `apps/dashboard/app/api/admin/sites/[siteId]/environments/[environment]/ingest-keys/[keyId]/route.ts` |
|   10 | 生产实现        | `apps/dashboard/app/api/admin/sites/[siteId]/environments/[environment]/ingest-keys/route.ts`         |
|   27 | 生产实现        | `apps/dashboard/app/api/admin/sites/[siteId]/environments/[environment]/ingest-policy/route.ts`       |
|    5 | 生产实现        | `apps/dashboard/app/api/admin/sites/route.ts`                                                         |
|   24 | 测试            | `apps/dashboard/app/dashboard/[report]/page.test.tsx`                                                 |
|   35 | 生产实现        | `apps/dashboard/app/dashboard/[report]/page.tsx`                                                      |
|   49 | 生产实现        | `apps/dashboard/app/dashboard/loading.tsx`                                                            |
|  100 | 测试            | `apps/dashboard/app/dashboard/page.test.tsx`                                                          |
|  169 | 生产实现        | `apps/dashboard/app/dashboard/page.tsx`                                                               |
|   11 | 生产实现        | `apps/dashboard/app/dashboard/settings/capabilities/page.tsx`                                         |
|   76 | 测试            | `apps/dashboard/app/dashboard/settings/definitions/page.test.tsx`                                     |
|  147 | 生产实现        | `apps/dashboard/app/dashboard/settings/definitions/page.tsx`                                          |
|   11 | 生产实现        | `apps/dashboard/app/dashboard/settings/environments/page.tsx`                                         |
|   11 | 生产实现        | `apps/dashboard/app/dashboard/settings/ingest-keys/page.tsx`                                          |
|   27 | 生产实现        | `apps/dashboard/app/dashboard/settings/loading.tsx`                                                   |
|  145 | 测试            | `apps/dashboard/app/dashboard/settings/overview/page.test.tsx`                                        |
|  175 | 生产实现        | `apps/dashboard/app/dashboard/settings/overview/page.tsx`                                             |
|   11 | 生产实现        | `apps/dashboard/app/dashboard/settings/page.tsx`                                                      |
|   18 | 生产实现        | `apps/dashboard/app/dashboard/sites/new/page.tsx`                                                     |
|   20 | 生产实现        | `apps/dashboard/app/layout.tsx`                                                                       |
|    5 | 生产实现        | `apps/dashboard/app/page.tsx`                                                                         |
|   41 | 测试            | `apps/dashboard/components/analytics-sidebar.test.tsx`                                                |
|  114 | 生产实现        | `apps/dashboard/components/analytics-sidebar.tsx`                                                     |
|  113 | 测试            | `apps/dashboard/components/audience-dimension-report-sections.test.tsx`                               |
|   93 | 生产实现        | `apps/dashboard/components/audience-dimension-report-sections.tsx`                                    |
|   92 | 测试            | `apps/dashboard/components/configuration-editor.initialize.ui.test.tsx`                               |
|  179 | 测试            | `apps/dashboard/components/configuration-editor.test.tsx`                                             |
|  419 | 生产实现        | `apps/dashboard/components/configuration-editor.tsx`                                                  |
|   92 | 测试            | `apps/dashboard/components/conversion-funnel-tables.test.tsx`                                         |
|  194 | 生产实现        | `apps/dashboard/components/conversion-funnel-tables.tsx`                                              |
|   88 | 测试            | `apps/dashboard/components/dashboard-loading-fallback.test.tsx`                                       |
|   77 | 测试            | `apps/dashboard/components/dashboard-loading-header.test.tsx`                                         |
|  130 | 生产实现        | `apps/dashboard/components/dashboard-loading-header.tsx`                                              |
|  107 | 生产实现        | `apps/dashboard/components/dashboard-sections.tsx`                                                    |
|  125 | 测试            | `apps/dashboard/components/dashboard-shell.test.tsx`                                                  |
|  280 | 生产实现        | `apps/dashboard/components/dashboard-shell.tsx`                                                       |
|  243 | 测试            | `apps/dashboard/components/definition-editor.test.tsx`                                                |
|  528 | 生产实现        | `apps/dashboard/components/definition-editor.tsx`                                                     |
|   56 | 测试            | `apps/dashboard/components/dimension-report-table.test.tsx`                                           |
|   60 | 生产实现        | `apps/dashboard/components/dimension-report-table.tsx`                                                |
|   74 | 测试            | `apps/dashboard/components/environment-selector.test.tsx`                                             |
|   71 | 生产实现        | `apps/dashboard/components/environment-selector.tsx`                                                  |
|   59 | 生产实现        | `apps/dashboard/components/event-report-table.tsx`                                                    |
|   94 | 测试            | `apps/dashboard/components/freshness-banner.test.tsx`                                                 |
|   48 | 生产实现        | `apps/dashboard/components/freshness-banner.tsx`                                                      |
|   91 | 测试            | `apps/dashboard/components/geo-country-table.test.tsx`                                                |
|   74 | 生产实现        | `apps/dashboard/components/geo-country-table.tsx`                                                     |
|  258 | 测试            | `apps/dashboard/components/ingest-keys-manager.test.tsx`                                              |
|  452 | 生产实现        | `apps/dashboard/components/ingest-keys-manager.tsx`                                                   |
|   37 | 测试            | `apps/dashboard/components/overview-card.test.tsx`                                                    |
|   23 | 生产实现        | `apps/dashboard/components/overview-card.tsx`                                                         |
|   15 | 测试            | `apps/dashboard/components/report-loading-state.test.tsx`                                             |
|   10 | 生产实现        | `apps/dashboard/components/report-loading-state.tsx`                                                  |
|   78 | 测试            | `apps/dashboard/components/settings-navigation.test.tsx`                                              |
|   68 | 生产实现        | `apps/dashboard/components/settings-navigation.tsx`                                                   |
|  106 | 测试            | `apps/dashboard/components/settings-task-page.test.tsx`                                               |
|  152 | 生产实现        | `apps/dashboard/components/settings-task-page.tsx`                                                    |
|  395 | 测试            | `apps/dashboard/components/site-connection-status.test.tsx`                                           |
|  246 | 生产实现        | `apps/dashboard/components/site-connection-status.tsx`                                                |
|   38 | 测试            | `apps/dashboard/components/site-creation-wizard.test.ts`                                              |
|  620 | 生产实现        | `apps/dashboard/components/site-creation-wizard.tsx`                                                  |
|  278 | 测试            | `apps/dashboard/components/site-creation-wizard.ui.test.tsx`                                          |
|   74 | 生产实现        | `apps/dashboard/components/site-directory-state.tsx`                                                  |
|   32 | 生产实现        | `apps/dashboard/components/states/disabled-state.tsx`                                                 |
|   14 | 生产实现        | `apps/dashboard/components/states/empty-state.tsx`                                                    |
|   25 | 生产实现        | `apps/dashboard/components/states/error-state.tsx`                                                    |
|   15 | 生产实现        | `apps/dashboard/components/states/loading-state.tsx`                                                  |
|   14 | 测试            | `apps/dashboard/components/states/state-copy.test.ts`                                                 |
|    6 | 生产实现        | `apps/dashboard/components/states/state-copy.ts`                                                      |
|   11 | 生产实现        | `apps/dashboard/components/states/success-state.tsx`                                                  |
|   18 | 生产实现        | `apps/dashboard/components/states/unavailable-state.tsx`                                              |
|   67 | 测试            | `apps/dashboard/components/timeline-table.test.tsx`                                                   |
|   67 | 生产实现        | `apps/dashboard/components/timeline-table.tsx`                                                        |
|   65 | 测试            | `apps/dashboard/components/top-pages-table.test.tsx`                                                  |
|   53 | 生产实现        | `apps/dashboard/components/top-pages-table.tsx`                                                       |
|  139 | 生产实现        | `apps/dashboard/components/traffic-and-outcome-report-sections.tsx`                                   |
|   60 | 测试            | `apps/dashboard/components/ui/alert-dialog.test.tsx`                                                  |
|   91 | 生产实现        | `apps/dashboard/components/ui/alert-dialog.tsx`                                                       |
|   27 | 生产实现        | `apps/dashboard/components/ui/alert.tsx`                                                              |
|   29 | 生产实现        | `apps/dashboard/components/ui/badge.tsx`                                                              |
|   51 | 生产实现        | `apps/dashboard/components/ui/button.tsx`                                                             |
|   12 | 生产实现        | `apps/dashboard/components/ui/card.tsx`                                                               |
|   20 | 生产实现        | `apps/dashboard/components/ui/checkbox.tsx`                                                           |
|    5 | 生产实现        | `apps/dashboard/components/ui/date-picker.tsx`                                                        |
|   11 | 生产实现        | `apps/dashboard/components/ui/index.ts`                                                               |
|   15 | 生产实现        | `apps/dashboard/components/ui/input.tsx`                                                              |
|   15 | 生产实现        | `apps/dashboard/components/ui/select.tsx`                                                             |
|   43 | 生产实现        | `apps/dashboard/components/ui/table.tsx`                                                              |
|   15 | 生产实现        | `apps/dashboard/components/ui/textarea.tsx`                                                           |
|  134 | 测试            | `apps/dashboard/components/visitor-session-trend-table.test.tsx`                                      |
|   79 | 生产实现        | `apps/dashboard/components/visitor-session-trend-table.tsx`                                           |
|   78 | 测试            | `apps/dashboard/components/web-vitals-table.test.tsx`                                                 |
|   65 | 生产实现        | `apps/dashboard/components/web-vitals-table.tsx`                                                      |
|   55 | 测试            | `apps/dashboard/config/sites.test.ts`                                                                 |
|   29 | 生产实现        | `apps/dashboard/config/sites.ts`                                                                      |
|   50 | 构建/CI tooling | `apps/dashboard/eslint.config.mjs`                                                                    |
|  511 | 测试            | `apps/dashboard/lib/analytics-api/client.test.ts`                                                     |
|  252 | 生产实现        | `apps/dashboard/lib/analytics-api/client.ts`                                                          |
|   27 | 生产实现        | `apps/dashboard/lib/analytics-api/config.ts`                                                          |
|   25 | 生产实现        | `apps/dashboard/lib/analytics-api/errors.ts`                                                          |
|  444 | 生产实现        | `apps/dashboard/lib/analytics-api/queries.ts`                                                         |
|  188 | 生产实现        | `apps/dashboard/lib/analytics-api/types.ts`                                                           |
|   41 | 生产实现        | `apps/dashboard/lib/analytics-report-copy.ts`                                                         |
|   47 | 测试            | `apps/dashboard/lib/configuration-api/errors.test.ts`                                                 |
|   31 | 生产实现        | `apps/dashboard/lib/configuration-api/errors.ts`                                                      |
|  148 | 测试            | `apps/dashboard/lib/configuration-api/proxy.test.ts`                                                  |
|   90 | 生产实现        | `apps/dashboard/lib/configuration-api/proxy.ts`                                                       |
|  130 | 测试            | `apps/dashboard/lib/configuration-api/server.test.ts`                                                 |
|  150 | 生产实现        | `apps/dashboard/lib/configuration-api/server.ts`                                                      |
|   89 | 生产实现        | `apps/dashboard/lib/configuration-api/types.ts`                                                       |
|    7 | 生产实现        | `apps/dashboard/lib/dashboard-dependencies.ts`                                                        |
|  111 | 测试            | `apps/dashboard/lib/dashboard-overview.test.ts`                                                       |
|   58 | 生产实现        | `apps/dashboard/lib/dashboard-overview.ts`                                                            |
|  116 | 测试            | `apps/dashboard/lib/dashboard-page-data.test.ts`                                                      |
|   71 | 生产实现        | `apps/dashboard/lib/dashboard-page-data.ts`                                                           |
|  401 | 测试            | `apps/dashboard/lib/dashboard-reports.test.ts`                                                        |
|  398 | 生产实现        | `apps/dashboard/lib/dashboard-reports.ts`                                                             |
|   12 | 生产实现        | `apps/dashboard/lib/dashboard-state.ts`                                                               |
|   71 | 测试            | `apps/dashboard/lib/definition-revision-history.test.ts`                                              |
|   89 | 生产实现        | `apps/dashboard/lib/definition-revision-history.ts`                                                   |
|   79 | 测试            | `apps/dashboard/lib/query-params.test.ts`                                                             |
|  155 | 生产实现        | `apps/dashboard/lib/query-params.ts`                                                                  |
|   99 | 测试            | `apps/dashboard/lib/settings-routes.test.ts`                                                          |
|   83 | 生产实现        | `apps/dashboard/lib/settings-routes.ts`                                                               |
|  169 | 测试            | `apps/dashboard/lib/site-management/client.test.ts`                                                   |
|  414 | 生产实现        | `apps/dashboard/lib/site-management/client.ts`                                                        |
|   25 | 生产实现        | `apps/dashboard/lib/site-management/config.ts`                                                        |
|    3 | 生产实现        | `apps/dashboard/lib/utils.ts`                                                                         |
|    7 | 构建/CI tooling | `apps/dashboard/next.config.ts`                                                                       |
|    7 | 构建/CI tooling | `apps/dashboard/postcss.config.mjs`                                                                   |
|  968 | 生产实现        | `apps/dashboard/styles.css`                                                                           |
|    7 | 构建/CI tooling | `apps/dashboard/vitest.config.ts`                                                                     |
|  604 | 生产实现        | `crates/configuration-runtime/src/lib.rs`                                                             |
|  360 | 生产实现        | `crates/configuration-runtime/src/registry.rs`                                                        |
|  126 | 生产实现        | `crates/configuration-runtime/src/views.rs`                                                           |
|   28 | 迁移/fixture    | `db/migrations/20260919000100_create_raw_events.sql`                                                  |
|   14 | 迁移/fixture    | `db/migrations/20260919000200_create_page_view_aggregates.sql`                                        |
|   61 | 迁移/fixture    | `db/migrations/20260921000300_create_phase6_pr1_metadata.sql`                                         |
|    6 | 迁移/fixture    | `db/migrations/20260921000400_add_phase6_watermark_constraints.sql`                                   |
|  126 | 迁移/fixture    | `db/migrations/20260922000500_create_phase6_pr3_derived.sql`                                          |
|   11 | 迁移/fixture    | `db/migrations/20260922000600_add_phase6_pr3_query_indexes.sql`                                       |
|   60 | 迁移/fixture    | `db/migrations/20260922000700_create_phase6_pr4_dimensions.sql`                                       |
|    2 | 迁移/fixture    | `db/migrations/20260922000800_deprecate_protocol_v2_flag.sql`                                         |
|   25 | 迁移/fixture    | `db/migrations/20260923000900_add_custom_event_facts.sql`                                             |
|   27 | 迁移/fixture    | `db/migrations/20260923001000_add_web_vital_facts.sql`                                                |
|   41 | 迁移/fixture    | `db/migrations/20260923001100_add_conversion_funnel_facts.sql`                                        |
|   22 | 迁移/fixture    | `db/migrations/20260924001200_add_geo_country_facts.sql`                                              |
|  339 | 迁移/fixture    | `db/migrations/20260925001300_create_configuration_storage.sql`                                       |
|   82 | 迁移/fixture    | `db/migrations/20260925001400_allow_empty_ingest_key_policies.sql`                                    |
|   27 | 迁移/fixture    | `db/migrations/20260925001500_create_configuration_runtime_state.sql`                                 |
|   49 | 迁移/fixture    | `db/migrations/20260925001600_add_capability_runtime_state.sql`                                       |
|   64 | 迁移/fixture    | `db/migrations/20260926001700_create_definition_revisions.sql`                                        |
|   47 | 迁移/fixture    | `db/migrations/20260930001800_create_site_registry.sql`                                               |
|   48 | 迁移/fixture    | `db/migrations/20261001001900_add_site_registry_references.sql`                                       |
|    5 | 迁移/fixture    | `db/migrations/20261001002000_pin_policy_validator_search_path.sql`                                   |
|   29 | 迁移/fixture    | `db/migrations/20261002002100_add_site_management_version_audit.sql`                                  |
|   35 | 迁移/fixture    | `db/migrations/20261003002200_align_site_registry_setup_readiness.sql`                                |
|   24 | 迁移/fixture    | `db/migrations/20261004002300_create_site_creation_requests.sql`                                      |
|  115 | 构建/CI tooling | `db/seeds/development/dev-seed.mjs`                                                                   |
|   50 | 测试            | `db/seeds/development/dev-seed.test.mjs`                                                              |
|  188 | 测试            | `db/tests/migrations.rs`                                                                              |
|  866 | 测试            | `db/tests/test-migrations.sh`                                                                         |
|   37 | 构建/CI tooling | `eslint.config.mjs`                                                                                   |
|    8 | 生产实现        | `examples/nextjs-router-playground/app/about/page.tsx`                                                |
|   59 | 生产实现        | `examples/nextjs-router-playground/app/components/navigation-controls.tsx`                            |
|  187 | 生产实现        | `examples/nextjs-router-playground/app/components/navigation-debug-panel.tsx`                         |
|   29 | 生产实现        | `examples/nextjs-router-playground/app/layout.tsx`                                                    |
|    8 | 生产实现        | `examples/nextjs-router-playground/app/nested/child/page.tsx`                                         |
|    8 | 生产实现        | `examples/nextjs-router-playground/app/nested/layout.tsx`                                             |
|    8 | 生产实现        | `examples/nextjs-router-playground/app/nested/page.tsx`                                               |
|    8 | 生产实现        | `examples/nextjs-router-playground/app/page.tsx`                                                      |
|   10 | 生产实现        | `examples/nextjs-router-playground/app/products/[slug]/page.tsx`                                      |
|    8 | 生产实现        | `examples/nextjs-router-playground/app/search/page.tsx`                                               |
|   40 | 构建/CI tooling | `examples/nextjs-router-playground/eslint.config.mjs`                                                 |
|   14 | 构建/CI tooling | `examples/nextjs-router-playground/next.config.ts`                                                    |
|   12 | 生产实现        | `examples/react-router-playground/index.html`                                                         |
|  105 | 生产实现        | `examples/react-router-playground/src/main.tsx`                                                       |
|    4 | 构建/CI tooling | `examples/react-router-playground/vite.config.ts`                                                     |
|   12 | 生产实现        | `examples/tanstack-router-playground/index.html`                                                      |
|  121 | 生产实现        | `examples/tanstack-router-playground/src/main.tsx`                                                    |
|    4 | 构建/CI tooling | `examples/tanstack-router-playground/vite.config.ts`                                                  |
|   82 | 实验产物        | `experiments/m0b/generated/json2ts/event.ts`                                                          |
|   26 | 实验产物        | `experiments/m0b/generated/json2ts/policy.ts`                                                         |
|   17 | 实验产物        | `experiments/m0b/generated/toolkit/policy.ts`                                                         |
|  316 | 实验产物        | `experiments/m0b/generated/typify/policy.rs`                                                          |
|  224 | 实验产物        | `experiments/m0b/parity/run.mjs`                                                                      |
|  390 | 实验产物        | `experiments/m0b/parity/rust/src/main.rs`                                                             |
|  341 | 实验产物        | `experiments/m0b/parity/typescript/static-validator.ts`                                               |
|  486 | 测试            | `packages/analytics-browser/src/analytics.test.ts`                                                    |
|  498 | 生产实现        | `packages/analytics-browser/src/analytics.ts`                                                         |
|   71 | 测试            | `packages/analytics-browser/src/browser-context.test.ts`                                              |
|   81 | 生产实现        | `packages/analytics-browser/src/browser-context.ts`                                                   |
|    8 | 生产实现        | `packages/analytics-browser/src/index.ts`                                                             |
|   16 | 生产实现        | `packages/analytics-browser/src/navigation.ts`                                                        |
|   65 | 测试            | `packages/analytics-browser/src/protocol.test.ts`                                                     |
|   64 | 测试            | `packages/analytics-browser/src/visitor-id.test.ts`                                                   |
|   66 | 生产实现        | `packages/analytics-browser/src/visitor-id.ts`                                                        |
|  281 | 测试            | `packages/analytics-browser/src/web-vitals.test.ts`                                                   |
|   17 | 构建/CI tooling | `packages/analytics-browser/vitest.config.ts`                                                         |
|   44 | 测试            | `packages/analytics-core/src/capabilities.test.ts`                                                    |
|   94 | 生产实现        | `packages/analytics-core/src/capabilities.ts`                                                         |
|   45 | 生产实现        | `packages/analytics-core/src/custom-event-factory.ts`                                                 |
|   36 | 生产实现        | `packages/analytics-core/src/event-factory.ts`                                                        |
|   14 | 生产实现        | `packages/analytics-core/src/index.ts`                                                                |
|  125 | 测试            | `packages/analytics-core/src/pipeline.test.ts`                                                        |
|   49 | 生产实现        | `packages/analytics-core/src/pipeline.ts`                                                             |
|   15 | 构建/CI tooling | `packages/analytics-core/vitest.config.ts`                                                            |
|   16 | 生产实现        | `packages/observer-core/src/index.ts`                                                                 |
|   51 | 测试            | `packages/observer-core/src/memory-observer.test.ts`                                                  |
|   23 | 生产实现        | `packages/observer-core/src/memory-observer.ts`                                                       |
|   68 | 生产实现        | `packages/observer-core/src/navigation-helpers.ts`                                                    |
|   18 | 生产实现        | `packages/observer-core/src/types.ts`                                                                 |
|    7 | 构建/CI tooling | `packages/observer-core/vitest.config.ts`                                                             |
|    5 | 生产实现        | `packages/observer-next/src/index.ts`                                                                 |
|   41 | 测试            | `packages/observer-next/src/navigation-event.test.ts`                                                 |
|    2 | 生产实现        | `packages/observer-next/src/navigation-event.ts`                                                      |
|   35 | 测试            | `packages/observer-next/src/navigation-state.test.ts`                                                 |
|    6 | 生产实现        | `packages/observer-next/src/navigation-state.ts`                                                      |
|  140 | 生产实现        | `packages/observer-next/src/next-navigation-bridge.tsx`                                               |
|    7 | 构建/CI tooling | `packages/observer-next/vitest.config.ts`                                                             |
|    2 | 生产实现        | `packages/observer-react-router/src/index.ts`                                                         |
|   95 | 测试            | `packages/observer-react-router/src/react-router-navigation-bridge.test.tsx`                          |
|   58 | 生产实现        | `packages/observer-react-router/src/react-router-navigation-bridge.tsx`                               |
|   11 | 构建/CI tooling | `packages/observer-react-router/vitest.config.ts`                                                     |
|   58 | 测试            | `packages/observer-tanstack-router/src/history-patch.test.ts`                                         |
|   81 | 生产实现        | `packages/observer-tanstack-router/src/history-patch.ts`                                              |
|    2 | 生产实现        | `packages/observer-tanstack-router/src/index.ts`                                                      |
|  113 | 测试            | `packages/observer-tanstack-router/src/tanstack-router-navigation-bridge.test.tsx`                    |
|  135 | 生产实现        | `packages/observer-tanstack-router/src/tanstack-router-navigation-bridge.tsx`                         |
|   11 | 构建/CI tooling | `packages/observer-tanstack-router/vitest.config.ts`                                                  |
|   45 | 生产实现        | `packages/playground-support/src/index.ts`                                                            |
|   18 | 生产实现        | `packages/protocol-ts/src/browser-context-v1.ts`                                                      |
|  128 | 生产实现        | `packages/protocol-ts/src/custom-event.ts`                                                            |
|    8 | 生产实现        | `packages/protocol-ts/src/event-batch.ts`                                                             |
|   45 | 生成代码        | `packages/protocol-ts/src/generated-configuration-type-probes.d.ts`                                   |
|   31 | 生成代码        | `packages/protocol-ts/src/generated/capabilities.ts`                                                  |
|   25 | 生成代码        | `packages/protocol-ts/src/generated/capability-update.ts`                                             |
|   36 | 生成代码        | `packages/protocol-ts/src/generated/conversion-funnel-definition-set-update.ts`                       |
|   15 | 生成代码        | `packages/protocol-ts/src/generated/environment-policy-update.ts`                                     |
|   26 | 生成代码        | `packages/protocol-ts/src/generated/environment-policy.ts`                                            |
|   38 | 生产实现        | `packages/protocol-ts/src/index.ts`                                                                   |
|   20 | 生产实现        | `packages/protocol-ts/src/page-view-event.ts`                                                         |
|   98 | 测试            | `packages/protocol-ts/src/protocol-ts.test.ts`                                                        |
|   56 | 生产实现        | `packages/protocol-ts/src/web-vital-event.ts`                                                         |
|    7 | 构建/CI tooling | `packages/protocol-ts/vitest.config.ts`                                                               |
|   39 | 生产实现        | `packages/router-adapters/src/bridge.tsx`                                                             |
|   19 | 生产实现        | `packages/router-adapters/src/next.tsx`                                                               |
|   28 | 测试            | `packages/router-adapters/src/package-exports.test.ts`                                                |
|   21 | 生产实现        | `packages/router-adapters/src/react-router.tsx`                                                       |
|  161 | 测试            | `packages/router-adapters/src/router-analytics-bridge.test.tsx`                                       |
|   21 | 生产实现        | `packages/router-adapters/src/tanstack-router.tsx`                                                    |
|   25 | 构建/CI tooling | `packages/router-adapters/vitest.config.ts`                                                           |
|   25 | 生产实现        | `packages/transport/src/errors.ts`                                                                    |
|  293 | 测试            | `packages/transport/src/fetch-transport.test.ts`                                                      |
|  142 | 生产实现        | `packages/transport/src/fetch-transport.ts`                                                           |
|    4 | 生产实现        | `packages/transport/src/index.ts`                                                                     |
|   15 | 构建/CI tooling | `packages/transport/vitest.config.ts`                                                                 |
|   89 | 生产实现        | `services/analytics-api/src/analytics/capability_runtime.rs`                                          |
|   64 | 生产实现        | `services/analytics-api/src/analytics/definition_catalog.rs`                                          |
|   60 | 生产实现        | `services/analytics-api/src/analytics/definition_revisions.rs`                                        |
|  136 | 生产实现        | `services/analytics-api/src/analytics/errors.rs`                                                      |
|  239 | 生产实现        | `services/analytics-api/src/analytics/handlers/audience_dimension_reports.rs`                         |
|   53 | 生产实现        | `services/analytics-api/src/analytics/handlers/geo.rs`                                                |
|    4 | 生产实现        | `services/analytics-api/src/analytics/handlers/mod.rs`                                                |
|   21 | 生产实现        | `services/analytics-api/src/analytics/handlers/overview.rs`                                           |
|  334 | 生产实现        | `services/analytics-api/src/analytics/handlers/reports.rs`                                            |
|   10 | 生产实现        | `services/analytics-api/src/analytics/mod.rs`                                                         |
|  274 | 生产实现        | `services/analytics-api/src/analytics/models.rs`                                                      |
|  672 | 生产实现        | `services/analytics-api/src/analytics/queries.rs`                                                     |
|   64 | 生产实现        | `services/analytics-api/src/analytics/routes.rs`                                                      |
|   28 | 生产实现        | `services/analytics-api/src/analytics/state.rs`                                                       |
|  271 | 生产实现        | `services/analytics-api/src/analytics/validation.rs`                                                  |
|   49 | 生产实现        | `services/analytics-api/src/lib.rs`                                                                   |
|   34 | 生产实现        | `services/analytics-api/src/main.rs`                                                                  |
|   35 | 生产实现        | `services/analytics-api/src/routes.rs`                                                                |
|  145 | 生产实现        | `services/analytics-api/src/site_management/auth.rs`                                                  |
| 1031 | 生产实现        | `services/analytics-api/src/site_management/config_store.rs`                                          |
| 1082 | 生产实现        | `services/analytics-api/src/site_management/configuration.rs`                                         |
|  461 | 生产实现        | `services/analytics-api/src/site_management/creation.rs`                                              |
|  128 | 生产实现        | `services/analytics-api/src/site_management/errors.rs`                                                |
|   10 | 生产实现        | `services/analytics-api/src/site_management/mod.rs`                                                   |
|   52 | 生产实现        | `services/analytics-api/src/site_management/routes.rs`                                                |
|  174 | 生产实现        | `services/analytics-api/src/site_management/site_store.rs`                                            |
|  421 | 生产实现        | `services/analytics-api/src/site_management/sites.rs`                                                 |
|   25 | 生产实现        | `services/analytics-api/src/site_management/state.rs`                                                 |
|  119 | 生产实现        | `services/analytics-api/src/site_management/validation.rs`                                            |
|   33 | 生产实现        | `services/analytics-api/src/state.rs`                                                                 |
| 2420 | 测试            | `services/analytics-api/tests/http.rs`                                                                |
|  452 | 测试            | `services/analytics-api/tests/module_boundaries.rs`                                                   |
|    1 | 生产实现        | `services/collector/src/capabilities.rs`                                                              |
|   90 | 生产实现        | `services/collector/src/cli.rs`                                                                       |
|  464 | 生产实现        | `services/collector/src/config.rs`                                                                    |
|   33 | 生产实现        | `services/collector/src/error.rs`                                                                     |
|  316 | 生成代码        | `services/collector/src/generated/environment_policy.rs`                                              |
|  239 | 生产实现        | `services/collector/src/geo.rs`                                                                       |
| 1086 | 生产实现        | `services/collector/src/http.rs`                                                                      |
|   37 | 生产实现        | `services/collector/src/key.rs`                                                                       |
|   14 | 生产实现        | `services/collector/src/lib.rs`                                                                       |
|    8 | 生产实现        | `services/collector/src/logging.rs`                                                                   |
|  106 | 生产实现        | `services/collector/src/main.rs`                                                                      |
|  289 | 生产实现        | `services/collector/src/protocol.rs`                                                                  |
|  112 | 生产实现        | `services/collector/src/rate_limit.rs`                                                                |
|  743 | 生产实现        | `services/collector/src/runtime_policy.rs`                                                            |
|  235 | 生产实现        | `services/collector/src/security.rs`                                                                  |
|  303 | 生产实现        | `services/collector/src/sink.rs`                                                                      |
|  396 | 生产实现        | `services/collector/src/validation.rs`                                                                |
|  331 | 测试            | `services/collector/tests/analytics_metadata_migration.rs`                                            |
|  411 | 测试            | `services/collector/tests/http_ingestion.rs`                                                          |
|   34 | 测试            | `services/collector/tests/key_cli.rs`                                                                 |
|  517 | 测试            | `services/collector/tests/postgres_storage.rs`                                                        |
|  419 | 测试            | `services/collector/tests/runtime_policy_postgres.rs`                                                 |
|   19 | 生产实现        | `services/processor/src/capabilities.rs`                                                              |
|  314 | 生产实现        | `services/processor/src/definitions.rs`                                                               |
|   39 | 生产实现        | `services/processor/src/error.rs`                                                                     |
|   19 | 生产实现        | `services/processor/src/lib.rs`                                                                       |
|  279 | 生产实现        | `services/processor/src/main.rs`                                                                      |
|   15 | 生产实现        | `services/processor/src/models.rs`                                                                    |
|  123 | 生产实现        | `services/processor/src/normalizer.rs`                                                                |
|  102 | 生产实现        | `services/processor/src/parser.rs`                                                                    |
| 1805 | 生产实现        | `services/processor/src/processor.rs`                                                                 |
|  253 | 生产实现        | `services/processor/src/queries.rs`                                                                   |
|  169 | 生产实现        | `services/processor/src/sessionizer.rs`                                                               |
|  203 | 测试            | `services/processor/tests/canonical_fixtures.rs`                                                      |
| 1340 | 测试            | `services/processor/tests/processor.rs`                                                               |
|  214 | 测试            | `tests/e2e/runner/cli.mjs`                                                                            |
|  201 | 测试            | `tests/e2e/runner/environment.mjs`                                                                    |
|   71 | 测试            | `tests/e2e/runner/runner.test.mjs`                                                                    |
|   76 | 测试            | `tests/e2e/runner/suite-registry.mjs`                                                                 |
|  609 | 测试            | `tests/e2e/suites/e2e-analytics.mjs`                                                                  |
|  490 | 测试            | `tests/e2e/suites/e2e-configuration.mjs`                                                              |
| 2033 | 测试            | `tests/e2e/suites/e2e-dashboard.mjs`                                                                  |
|  265 | 测试            | `tests/e2e/suites/e2e-dev-startup.mjs`                                                                |
|  161 | 测试            | `tests/e2e/suites/e2e-router-adapters.mjs`                                                            |
|   43 | 测试            | `tests/e2e/suites/e2e-router-compose.mjs`                                                             |
|  295 | 测试            | `tests/e2e/suites/e2e-site-management.mjs`                                                            |
|  307 | 测试            | `tests/e2e/suites/e2e-site-onboarding.mjs`                                                            |
|   90 | 测试            | `tests/e2e/support/e2e-cache.mjs`                                                                     |
|   34 | 测试            | `tests/e2e/support/e2e-capabilities.mjs`                                                              |
|  145 | 测试            | `tests/e2e/support/e2e-compose.mjs`                                                                   |
|  106 | 测试            | `tests/e2e/support/e2e-database.mjs`                                                                  |
|   79 | 测试            | `tests/e2e/support/e2e-database.test.mjs`                                                             |
|   55 | 测试            | `tests/e2e/support/e2e-ingest-policies.mjs`                                                           |
|  283 | 构建/CI tooling | `tooling/ci/audit-policy-datetimes.mjs`                                                               |
|   12 | 构建/CI tooling | `tooling/ci/build.sh`                                                                                 |
|   28 | 构建/CI tooling | `tooling/ci/check.sh`                                                                                 |
|   10 | 构建/CI tooling | `tooling/ci/format-check.sh`                                                                          |
|    7 | 构建/CI tooling | `tooling/ci/format-docs-check.sh`                                                                     |
|   10 | 构建/CI tooling | `tooling/ci/format.sh`                                                                                |
|   94 | 构建/CI tooling | `tooling/ci/measure-ci-e2e.mjs`                                                                       |
|   18 | 构建/CI tooling | `tooling/ci/test-integration.sh`                                                                      |
|   39 | 构建/CI tooling | `tooling/ci/test.sh`                                                                                  |
|   59 | 构建/CI tooling | `tooling/contracts/capability-seed.mjs`                                                               |
|   30 | 测试            | `tooling/contracts/capability-seed.test.mjs`                                                          |
|  116 | 构建/CI tooling | `tooling/contracts/check-configuration-contract-parity.mjs`                                           |
|   49 | 构建/CI tooling | `tooling/contracts/check-contract-fixture-schema-baseline.mjs`                                        |
|  379 | 构建/CI tooling | `tooling/contracts/compare-contract-type-generators.mjs`                                              |
|  132 | 构建/CI tooling | `tooling/contracts/generate-configuration-contract-types.mjs`                                         |
|  716 | 构建/CI tooling | `tooling/contracts/validate-analytics-api-contract.mjs`                                               |
|   30 | 构建/CI tooling | `tooling/contracts/validate-analytics-definitions.mjs`                                                |
|  141 | 构建/CI tooling | `tooling/contracts/validate-capabilities.mjs`                                                         |
|  592 | 构建/CI tooling | `tooling/contracts/validate-configuration-contract.mjs`                                               |
|  131 | 构建/CI tooling | `tooling/contracts/validate-contract-layout.mjs`                                                      |
|  333 | 构建/CI tooling | `tooling/contracts/validate-http-fixtures.mjs`                                                        |
|  157 | 构建/CI tooling | `tooling/contracts/validate-protocol.mjs`                                                             |
|   12 | 构建/CI tooling | `tooling/db/db-migrate.sh`                                                                            |
|   12 | 构建/CI tooling | `tooling/db/purge-configuration-audit.sh`                                                             |
|  164 | 构建/CI tooling | `tooling/dev/dev-compose.mjs`                                                                         |
|  117 | 测试            | `tooling/dev/dev-compose.test.mjs`                                                                    |
|   35 | 构建/CI tooling | `tooling/dev/dev.mjs`                                                                                 |
|   34 | 构建/CI tooling | `tooling/dev/docker-dev.mjs`                                                                          |
|  204 | 构建/CI tooling | `tooling/dev/native-rust.mjs`                                                                         |
|  103 | 构建/CI tooling | `tooling/dev/router-targets.mjs`                                                                      |
|   46 | 测试            | `tooling/dev/router-targets.test.mjs`                                                                 |
|    3 | 构建/CI tooling | `tools/db-migrator/build.rs`                                                                          |
|   68 | 构建/CI tooling | `tools/db-migrator/src/lib.rs`                                                                        |
|   39 | 构建/CI tooling | `tools/db-migrator/src/main.rs`                                                                       |
|    1 | 测试            | `tools/db-migrator/tests/migrations.rs`                                                               |
|  795 | 构建/CI tooling | `tools/site-registry-importer/src/lib.rs`                                                             |
|  443 | 构建/CI tooling | `tools/site-registry-importer/src/main.rs`                                                            |

## 大文件候选（>200 行）

| 行数 | 类别            | 文件                                                                          | 所属切片 / 处置                     |
| ---: | --------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| 2420 | 测试            | `services/analytics-api/tests/http.rs`                                        | Rust Collector / API / runtime 切片 |
| 2033 | 测试            | `tests/e2e/suites/e2e-dashboard.mjs`                                          | E2E runner / suite 切片             |
| 1805 | 生产实现        | `services/processor/src/processor.rs`                                         | Processor 实现或测试切片            |
| 1340 | 测试            | `services/processor/tests/processor.rs`                                       | Processor 实现或测试切片            |
| 1086 | 生产实现        | `services/collector/src/http.rs`                                              | Rust Collector / API / runtime 切片 |
| 1082 | 生产实现        | `services/analytics-api/src/site_management/configuration.rs`                 | Rust Collector / API / runtime 切片 |
| 1031 | 生产实现        | `services/analytics-api/src/site_management/config_store.rs`                  | Rust Collector / API / runtime 切片 |
|  968 | 生产实现        | `apps/dashboard/styles.css`                                                   | Dashboard UI / API / 样式切片       |
|  866 | 测试            | `db/tests/test-migrations.sh`                                                 | 迁移测试 / CLI tooling 单独评估     |
|  795 | 构建/CI tooling | `tools/site-registry-importer/src/lib.rs`                                     | 迁移测试 / CLI tooling 单独评估     |
|  743 | 生产实现        | `services/collector/src/runtime_policy.rs`                                    | Rust Collector / API / runtime 切片 |
|  716 | 构建/CI tooling | `tooling/contracts/validate-analytics-api-contract.mjs`                       | 契约 tooling 切片                   |
|  672 | 生产实现        | `services/analytics-api/src/analytics/queries.rs`                             | Rust Collector / API / runtime 切片 |
|  620 | 生产实现        | `apps/dashboard/components/site-creation-wizard.tsx`                          | Dashboard UI / API / 样式切片       |
|  609 | 测试            | `tests/e2e/suites/e2e-analytics.mjs`                                          | E2E runner / suite 切片             |
|  604 | 生产实现        | `crates/configuration-runtime/src/lib.rs`                                     | Rust Collector / API / runtime 切片 |
|  592 | 构建/CI tooling | `tooling/contracts/validate-configuration-contract.mjs`                       | 契约 tooling 切片                   |
|  528 | 生产实现        | `apps/dashboard/components/definition-editor.tsx`                             | Dashboard UI / API / 样式切片       |
|  517 | 测试            | `services/collector/tests/postgres_storage.rs`                                | Rust Collector / API / runtime 切片 |
|  511 | 测试            | `apps/dashboard/lib/analytics-api/client.test.ts`                             | Dashboard UI / API / 样式切片       |
|  498 | 生产实现        | `packages/analytics-browser/src/analytics.ts`                                 | 其他相关测试或 tooling；单独评估    |
|  490 | 测试            | `tests/e2e/suites/e2e-configuration.mjs`                                      | E2E runner / suite 切片             |
|  486 | 测试            | `packages/analytics-browser/src/analytics.test.ts`                            | 其他相关测试或 tooling；单独评估    |
|  464 | 生产实现        | `services/collector/src/config.rs`                                            | Rust Collector / API / runtime 切片 |
|  461 | 生产实现        | `services/analytics-api/src/site_management/creation.rs`                      | Rust Collector / API / runtime 切片 |
|  452 | 生产实现        | `apps/dashboard/components/ingest-keys-manager.tsx`                           | Dashboard UI / API / 样式切片       |
|  452 | 测试            | `services/analytics-api/tests/module_boundaries.rs`                           | Rust Collector / API / runtime 切片 |
|  444 | 生产实现        | `apps/dashboard/lib/analytics-api/queries.ts`                                 | Dashboard UI / API / 样式切片       |
|  443 | 构建/CI tooling | `tools/site-registry-importer/src/main.rs`                                    | 迁移测试 / CLI tooling 单独评估     |
|  421 | 生产实现        | `services/analytics-api/src/site_management/sites.rs`                         | Rust Collector / API / runtime 切片 |
|  419 | 生产实现        | `apps/dashboard/components/configuration-editor.tsx`                          | Dashboard UI / API / 样式切片       |
|  419 | 测试            | `services/collector/tests/runtime_policy_postgres.rs`                         | Rust Collector / API / runtime 切片 |
|  414 | 生产实现        | `apps/dashboard/lib/site-management/client.ts`                                | Dashboard UI / API / 样式切片       |
|  411 | 测试            | `services/collector/tests/http_ingestion.rs`                                  | Rust Collector / API / runtime 切片 |
|  401 | 测试            | `apps/dashboard/lib/dashboard-reports.test.ts`                                | Dashboard UI / API / 样式切片       |
|  398 | 生产实现        | `apps/dashboard/lib/dashboard-reports.ts`                                     | Dashboard UI / API / 样式切片       |
|  396 | 生产实现        | `services/collector/src/validation.rs`                                        | Rust Collector / API / runtime 切片 |
|  395 | 测试            | `apps/dashboard/components/site-connection-status.test.tsx`                   | Dashboard UI / API / 样式切片       |
|  390 | 实验产物        | `experiments/m0b/parity/rust/src/main.rs`                                     | 实验产物：单独评估                  |
|  379 | 构建/CI tooling | `tooling/contracts/compare-contract-type-generators.mjs`                      | 契约 tooling 切片                   |
|  360 | 生产实现        | `crates/configuration-runtime/src/registry.rs`                                | Rust Collector / API / runtime 切片 |
|  341 | 实验产物        | `experiments/m0b/parity/typescript/static-validator.ts`                       | 实验产物：单独评估                  |
|  339 | 迁移/fixture    | `db/migrations/20260925001300_create_configuration_storage.sql`               | 历史迁移/fixture：排除生产拆分指标  |
|  334 | 生产实现        | `services/analytics-api/src/analytics/handlers/reports.rs`                    | Rust Collector / API / runtime 切片 |
|  333 | 构建/CI tooling | `tooling/contracts/validate-http-fixtures.mjs`                                | 契约 tooling 切片                   |
|  331 | 测试            | `services/collector/tests/analytics_metadata_migration.rs`                    | Rust Collector / API / runtime 切片 |
|  316 | 实验产物        | `experiments/m0b/generated/typify/policy.rs`                                  | 实验产物：单独评估                  |
|  316 | 生成代码        | `services/collector/src/generated/environment_policy.rs`                      | 生成代码：回到生成源评估            |
|  314 | 生产实现        | `services/processor/src/definitions.rs`                                       | Processor 实现或测试切片            |
|  307 | 测试            | `tests/e2e/suites/e2e-site-onboarding.mjs`                                    | E2E runner / suite 切片             |
|  303 | 生产实现        | `services/collector/src/sink.rs`                                              | Rust Collector / API / runtime 切片 |
|  295 | 测试            | `tests/e2e/suites/e2e-site-management.mjs`                                    | E2E runner / suite 切片             |
|  293 | 测试            | `packages/transport/src/fetch-transport.test.ts`                              | 其他相关测试或 tooling；单独评估    |
|  289 | 生产实现        | `services/collector/src/protocol.rs`                                          | Rust Collector / API / runtime 切片 |
|  283 | 构建/CI tooling | `tooling/ci/audit-policy-datetimes.mjs`                                       | 其他相关测试或 tooling；单独评估    |
|  281 | 测试            | `packages/analytics-browser/src/web-vitals.test.ts`                           | 其他相关测试或 tooling；单独评估    |
|  280 | 生产实现        | `apps/dashboard/components/dashboard-shell.tsx`                               | Dashboard UI / API / 样式切片       |
|  279 | 生产实现        | `services/processor/src/main.rs`                                              | Processor 实现或测试切片            |
|  278 | 测试            | `apps/dashboard/components/site-creation-wizard.ui.test.tsx`                  | Dashboard UI / API / 样式切片       |
|  274 | 生产实现        | `services/analytics-api/src/analytics/models.rs`                              | Rust Collector / API / runtime 切片 |
|  271 | 生产实现        | `services/analytics-api/src/analytics/validation.rs`                          | Rust Collector / API / runtime 切片 |
|  265 | 测试            | `tests/e2e/suites/e2e-dev-startup.mjs`                                        | E2E runner / suite 切片             |
|  258 | 测试            | `apps/dashboard/components/ingest-keys-manager.test.tsx`                      | Dashboard UI / API / 样式切片       |
|  253 | 生产实现        | `services/processor/src/queries.rs`                                           | Processor 实现或测试切片            |
|  252 | 生产实现        | `apps/dashboard/lib/analytics-api/client.ts`                                  | Dashboard UI / API / 样式切片       |
|  246 | 生产实现        | `apps/dashboard/components/site-connection-status.tsx`                        | Dashboard UI / API / 样式切片       |
|  243 | 测试            | `apps/dashboard/components/definition-editor.test.tsx`                        | Dashboard UI / API / 样式切片       |
|  239 | 生产实现        | `services/analytics-api/src/analytics/handlers/audience_dimension_reports.rs` | Rust Collector / API / runtime 切片 |
|  239 | 生产实现        | `services/collector/src/geo.rs`                                               | Rust Collector / API / runtime 切片 |
|  235 | 生产实现        | `services/collector/src/security.rs`                                          | Rust Collector / API / runtime 切片 |
|  224 | 实验产物        | `experiments/m0b/parity/run.mjs`                                              | 实验产物：单独评估                  |
|  214 | 测试            | `tests/e2e/runner/cli.mjs`                                                    | E2E runner / suite 切片             |
|  204 | 构建/CI tooling | `tooling/dev/native-rust.mjs`                                                 | 其他相关测试或 tooling；单独评估    |
|  203 | 测试            | `services/processor/tests/canonical_fixtures.rs`                              | Processor 实现或测试切片            |
|  201 | 测试            | `tests/e2e/runner/environment.mjs`                                            | E2E runner / suite 切片             |
