# 文档

## 当前文档

- [功能冻结与部署待办](project-status.md)：唯一的未完成、计划中和暂缺事项清单。
- [MVP 功能范围](mvp-scope.md)：冻结的产品范围与已交付基线。
- [开始使用](getting-started.md)：本地环境配置与运行。
- [Raspberry Pi LAN Deployment](deployment-raspberry-pi.md)：Pi 上拉取预构建镜像、局域网访问与日常操作。
- [Linux Deployment](deployment-linux.md)：x86-64 Linux 上的 GHCR 登录、部署、升级和回滚。
- [预构建容器镜像部署计划](deployment-prebuilt-images-plan.md)：多架构 GHCR 发布、原生架构 smoke 与 pull-only Compose 的实施记录。
- [运维指南](operations.md)：PostgreSQL 备份恢复、migration 部署和 Geo 数据库操作。
- [PostgreSQL 测试隔离设计](testing/postgres-test-isolation-plan.md)：后端 PostgreSQL 集成测试的隔离模型、组件命令和验收目标。
- [Browser SDK 对外接入与发布计划](browser-sdk-integration-plan.md)：通用 Navigation API SDK 的对外接入、兼容和发布计划。
- [Dashboard 图表设计](dashboard-chart-design.md)：Analytics 指标图表的实现状态、数据语义和剩余验收项。
- [Website 产品预览与 Dashboard 一致性改进计划](website-dashboard-preview-alignment-plan.md)：让展示网站中的产品预览在指标内容、图表表达和视觉风格上与 Dashboard 对齐。
- [Traceleaf 品牌统一与 Logo 接入方案](traceleaf-brand-unification-plan.md)：记录 Logo 来源、品牌用语规则、应用接入和验收结果。
- [静态产品展示站规划](static-product-site-plan.md)：面向开发者的独立静态站点、产品演示、快速开始与 Updates 规划（提案，实施前需确认范围）。
- [ADR-022: 通用 Navigation API observer](decisions/ADR-022-navigation-api-only-browser-sdk.md)：使用单一浏览器级 observer 并移除 Router 专用集成。
- [ADR-026: 多架构平台容器镜像发布](decisions/ADR-026-multi-architecture-container-releases.md)：统一发布 x86-64 Linux 与 64-bit ARM 平台镜像，并通过 GHCR 部署。
- [事件协议](event-protocol.md)：事件语义摘要；机器可读契约以 `protocol/` 为准。
- [Ingest Key 指南](ingest-key.md)：创建、使用和轮换密钥。
- [架构决策](decisions/)：仍有效的 ADR。
- [协议契约](../protocol/README.md)：Schema、HTTP 合约和 fixtures。

## 历史记录

- [开发阶段记录](archive/README.md)：已完成阶段的设计与验收记录。
- [代码重构记录](archive/refactoring/README.md)：已关闭的重构工作包及其历史验收证据。
