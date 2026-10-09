# 功能冻结与部署待办

> 状态：MVP 功能冻结。自 2026-10-04 起不增加新功能；只接受发布阻塞缺陷、安全修复和部署准备变更。本文是唯一的未完成、计划中和暂缺事项清单。

## 当前基线

- MVP 功能范围见 [MVP Scope](mvp-scope.md)。功能与开发阶段记录不代表生产部署已验收。
- 最近一次功能基线提交：`2cdbc87`。发布时应以实际选定的 release commit/tag 为准。
- Dashboard 本地类型检查、lint、单测、构建及格式检查通过；完整仓库 `pnpm check` 和格式检查通过。已记录的 CI 与 E2E 通过结果见历史归档。
- 最近一次重新启动 `pnpm e2e:dashboard` 未完成：卡在容器依赖安装阶段后中止；这次尝试不作为发布版本的 E2E 通过证据。
- Raspberry Pi 4B 局域网部署的 production Compose、环境模板和操作说明已建立；尚未在 Pi 上完成 ARM64 镜像构建、端到端运行、备份恢复演练和正式发布验收。

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
- 从独立消费者验证 Browser SDK 发布方式，再决定是否发布到外部 registry。

## PostgreSQL 测试隔离

- 后端 PostgreSQL 集成测试使用专用测试 Compose 项目和独立临时数据库；组件命令、生命周期与清理方式见 [PostgreSQL 测试隔离设计](testing/postgres-test-isolation-plan.md) 和 [运维指南](operations.md#database-migrations-and-tests)。

## 暂缺能力与范围边界

- 多用户身份、角色和 Site 级授权未实现。若管理界面不能保持在受信任网络或受访问代理保护的环境，此项转为发布阻塞项。
- Site URL 可达性检查和域名所有权验证未实现；MVP 使用 URL/Origin 校验与首个事件确认接入。
- retention、Geo 扩展、Firefox/WebKit 自动化覆盖、Replay、Heatmap 和高规模/实时处理不属于当前冻结范围。
- 开发 seed 和 Router Playground 仅用于本地验证，不构成生产初始化或生产分析数据来源。

## 冻结期间的变更规则

- 不增加产品功能、分析指标、API/协议能力或 SDK 集成范围。
- 可合入发布阻塞缺陷、安全修复、迁移兼容、部署/恢复和文档修正；每项变更必须保持本文件中的验收状态准确。
- 新需求只登记为未来候选项。解除冻结须由项目维护者明确决定，并更新 MVP Scope 与发布基线。
