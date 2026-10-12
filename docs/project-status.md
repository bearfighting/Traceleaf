# 功能冻结与部署待办

> 状态：MVP 其他功能继续冻结。自 2026-10-04 起不增加其他新功能；Browser SDK 对外发布准备已获限范围批准，尚未完成发布验收，也未授权立即推送 registry。本文是唯一的未完成、计划中和暂缺事项清单。

## 当前基线

- MVP 功能范围见 [MVP Scope](mvp-scope.md)。功能与开发阶段记录不代表生产部署已验收。
- 最近一次功能基线提交：`2cdbc87`。发布时应以实际选定的 release commit/tag 为准。
- Dashboard 本地类型检查、lint、单测、构建及格式检查通过；完整仓库 `pnpm check` 和格式检查通过。已记录的 CI 与 E2E 通过结果见历史归档。
- 最近一次重新启动 `pnpm e2e:dashboard` 未完成：卡在容器依赖安装阶段后中止；这次尝试不作为发布版本的 E2E 通过证据。
- Raspberry Pi 4B 局域网部署的 production Compose、环境模板和操作说明已建立；尚未在 Pi 上完成 ARM64 镜像构建、端到端运行、备份恢复演练和正式发布验收。
- Browser SDK 对外发布准备已获批；SDK 包发布验收尚未完成，registry 发布尚未执行，须待验收通过后进行。此授权不替代产品部署验收。

## Browser SDK 发布前待办

以下清单只跟踪 `@traceleaf/browser` 包发布前的工作；详细范围与阶段记录见 [Browser SDK 对外接入与发布计划](browser-sdk-integration-plan.md)。现有 tarball 独立消费者验收和九个 Playground 的 Chromium Navigation API E2E 已有通过记录，但不替代以下验收，也不构成完整浏览器或框架支持承诺。

维护者于 2026-10-11 明确暂缓以下两项，当前不安排执行：目标部署环境的 Collector Protocol V1 兼容确认，以及 Firefox/Safari/WebKit 的兼容性和支持范围验收。它们仍未验证；重新纳入工作需维护者明确提出。暂缓不代表通过，也不自动批准 registry 发布。

- [ ] 验证 SDK → Collector 契约：事件格式、显式配置、Origin/CORS、批次限制、错误响应和 Collector 不可用行为；仓库内验证已完成，目标部署 Collector 的 Protocol V1 兼容确认暂缓，三处错误 fixture 差异已修正。
- [x] 在隔离 E2E Compose 通过 browser → Collector → PostgreSQL → Processor → Analytics API/Dashboard 链路，并覆盖空数据、Collector 503/不可用、无效配置、抛错错误回调及拒绝 Origin；详见 [Browser SDK 验收记录](browser-sdk-integration-plan.md#隔离-browser-sdk-数据链路验收-2026-10-11)。此结果不代表 Raspberry Pi/生产部署验收。
- [x] 在隔离 Browser SDK E2E 验收 Chromium 实际发出的 Collector CORS 预检：204、匹配 Playground Origin、允许 POST 和 Content-Type/X-Ingest-Key；详见 [CORS 预检验收记录](browser-sdk-integration-plan.md#chromium-cors-预检验收-2026-10-11)。
- [ ] （暂缓）验收 Firefox 与 Safari/WebKit 支持范围；日志策略、批次限制、有限缓冲/flush 已通过针对性测试，详见 [Browser SDK 日志、缓冲与批次验收](browser-sdk-integration-plan.md#日志策略缓冲与批次限制验收-2026-10-11)。Chromium 结果不替代跨浏览器验收。
- [x] 完成并记录 Browser SDK 相关单测、集成、E2E、构建、类型检查和格式检查；详见 [Browser SDK 基础质量验收](browser-sdk-integration-plan.md#browser-sdk-基础质量验收-2026-10-11)。该结果不替代完整仓库 CI 或生产部署验收。
- [ ] （暂缓）在 Firefox 与 Safari/WebKit 验证目标版本、initial/客户端导航/back-forward 等行为，并确定不支持 Navigation API 时的行为；将实测矩阵及支持范围写入接入文档和发布说明。当前 Chromium 结果不代替此项。
- [ ] 确认 semver/版本策略、CI 发布校验、registry 权限、预发布或 dry-run、回滚与弃用流程。
- [ ] 上述验收通过后再解除 `private` 并执行 registry 发布，记录发布版本和结果。

## 发布前必须完成

| 项目                            | 验收条件                                                                                                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 选定部署目标并冻结配置          | 记录目标环境、公开入口、服务地址、必需环境变量、secret 来源和恢复负责人；生产配置不依赖开发默认值。                                                                                                                                                                     |
| 按目标环境执行数据库迁移        | 先备份；对已有数据运行 date-time/configuration preflight 并处理发现项；按 [M3 Registry](archive/development/m3-site-registry-checklist.md) 和 [M4 配置权威切换](archive/development/m4-runtime-configuration-authority-checklist.md) 执行逐目标 rollout 与 postflight。 |
| 限制管理界面访问                | 当前全局 deployment-admin token 只适用于受信任环境。上线前确认 Dashboard 位于私有网络或受访问代理保护；若要公开管理访问，必须先设计并实现身份验证与授权。                                                                                                               |
| 验证备份与回滚                  | 在目标部署环境实测数据库备份恢复和服务镜像回滚，记录可恢复结果与责任人。                                                                                                                                                                                                |
| 对 release candidate 做完整验证 | 对选定 commit 运行 `pnpm check`、`pnpm test`、`pnpm build`、`pnpm format:check`、`pnpm format:check:docs`、数据库迁移/集成测试和关键 E2E；记录实际环境与结果。E2E 要使用隔离环境并确认清理完成。                                                                        |
| 完成 Dashboard 产品验收         | 检查报表路由、筛选和历史导航、Settings/onboarding、加载/错误状态、键盘焦点及 320–1440px 响应式；完成 Firefox + Orca 辅助技术检查，并保存结果。                                                                                                                          |
| 确认最低运维观测                | 确认健康检查、错误告警、日志脱敏、限流和故障响应流程在目标环境可用。                                                                                                                                                                                                    |

## 上线后计划

- 根据 nightly/tag full-validation 的实际 job 测量评估 CI 关键路径和跨 runner BuildKit 缓存收益；有数据支持后再决定是否优化。
- 根据真实数据量制定 raw events、context、facts 与 aggregates 的保留和删除策略。
- 观察 Geo country 覆盖率，并演练正式 MMDB 的更新与回滚。
- 根据实际构建与 CI 数据评估缓存优化。
- 完成已获批的 Browser SDK 发布准备及独立消费者验收；实际 registry 发布须在验收通过后另行执行。
- Browser SDK 对外接入与发布计划见 [Browser SDK 对外接入与发布计划](browser-sdk-integration-plan.md)。授权仅覆盖完成并发布现有 Browser SDK 所需的准备、修复和验证，不批准新增 Analytics 功能或扩大产品范围；MVP 其他功能继续冻结。
- Firefox 与 Safari/WebKit 的 Navigation API 兼容性及公开支持矩阵目前由维护者明确暂缓；恢复时再确定目标版本与不支持 Navigation API 时的行为，不预设 History API fallback。

## PostgreSQL 测试隔离

- 后端 PostgreSQL 集成测试使用专用测试 Compose 项目和独立临时数据库；组件命令、生命周期与清理方式见 [PostgreSQL 测试隔离设计](testing/postgres-test-isolation-plan.md) 和 [运维指南](operations.md#database-migrations-and-tests)。

## 暂缺能力与范围边界

- 多用户身份、角色和 Site 级授权未实现。若管理界面不能保持在受信任网络或受访问代理保护的环境，此项转为发布阻塞项。
- Site URL 可达性检查和域名所有权验证未实现；MVP 使用 URL/Origin 校验与首个事件确认接入。
- retention、Geo 扩展、Firefox/WebKit 自动化覆盖、Replay、Heatmap 和高规模/实时处理不属于当前冻结范围。Firefox 与 Safari/WebKit 的 SDK 兼容验证当前明确暂缓，见 [Browser SDK 计划](browser-sdk-integration-plan.md)。
- 开发 seed 和 Router Playground 仅用于本地验证，不构成生产初始化或生产分析数据来源。

## 冻结期间的变更规则

- 不增加产品功能、分析指标、API/协议能力或 SDK 集成范围；Browser SDK 发布准备的明确授权范围除外。
- 已单独批准一个有限例外：按 [ADR-022](decisions/ADR-022-navigation-api-only-browser-sdk.md) 收敛 Browser SDK 导航观察；使用 Navigation API，移除框架专用 observer / adapter / bridge，不实现 History API 检测或 fallback。该导航观察决策本身不扩大为其他 SDK 功能授权；SDK 发布准备由下条单独授权。
- 已获准完成并发布现有 Browser SDK。该授权允许必要的发布准备、兼容修复和验收，不构成包已通过验收或可立即发布 registry 的证明，也不解除 MVP 其他范围的冻结。
- 可合入发布阻塞缺陷、安全修复、迁移兼容、部署/恢复和文档修正；每项变更必须保持本文件中的验收状态准确。
- 新需求只登记为未来候选项。解除冻结须由项目维护者明确决定，并更新 MVP Scope 与发布基线。
