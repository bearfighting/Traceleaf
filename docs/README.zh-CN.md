# Traceleaf 文档

本索引按读者要完成的任务组织文档。**current reference（当前参考）** 表示权威指南，**accepted decision（已接受决策）** 表示已批准的架构选择，**active proposal（进行中的提案）** 表示仍在讨论或实施中的工作与设计，**completed record（已完成记录）** 保存实现或发布证据，**superseded（已取代）** 表示决策已被后续决策替代，**historical（历史记录）** 表示归档内容。

[English documentation index](README.md) 提供相同的链接和生命周期标签。

## 了解项目

- [项目状态](project-status.md) — **current reference（当前参考）**；未完成、暂缓和发布阻塞事项的唯一清单。
- [MVP 范围](mvp-scope.md) — **current reference（当前参考）**；冻结的产品范围和已交付基线。
- [文档改进计划](archive/documentation-improvement-plan.md) — **historical（历史记录）**；已完成的规范、清单和验收证据。

## 本地开始与开发

- [开始使用](getting-started.md) — **current reference（当前参考）**；配置并运行本地环境。
- [PostgreSQL 测试隔离](testing/postgres-test-isolation-plan.md) — **current reference（当前参考）**；集成测试命令、隔离和清理方式。
- [协议契约](../protocol/README.md) — **current reference（当前参考）**；机器可读 Schema、HTTP 契约和 fixtures。

## 部署与运维

- [Linux 部署](deployment-linux.md) — **current reference（当前参考）**；在 x86-64 Linux 上部署和更新。
- [Raspberry Pi 局域网部署](deployment-raspberry-pi.md) — **current reference（当前参考）**；在 Raspberry Pi 上部署预构建镜像并供局域网访问。
- [运维指南](operations.md) — **current reference（当前参考）**；数据库备份、迁移和 Geo 数据库操作。
- [Ingest Key 指南](ingest-key.md) — **current reference（当前参考）**；创建、使用和轮换 ingest key。
- [版本与发布流程](versioning-and-release-process.md) — **current reference（当前参考）**；版本来源、发布步骤和检查。
- [预构建镜像部署计划](deployment-prebuilt-images-plan.md) — **completed record（已完成记录）**；多架构镜像的实现与 CI 发布证据。实机验收和运维门禁以项目状态为准。
- [平台 v1.0.0 发布记录](platform-release-v1.0.0.md) — **completed record（已完成记录）**；已发布镜像 digest、CI 和 smoke 验收证据。剩余部署和发布门禁以项目状态为准。

## 接入 Browser SDK 与使用协议

- [事件协议](event-protocol.md) — **current reference（当前参考）**；事件语义概览。`protocol/` 中的机器可读契约为权威来源。
- [Browser SDK 接入计划](browser-sdk-integration-plan.md) — **active proposal（进行中的提案）**；SDK 接入、兼容性和发布证据。未完成的门禁以项目状态为准。
- [Browser SDK 数据接入契约审计](browser-sdk-ingestion-contract-audit.md) — **completed record（已完成记录）**；契约审计证据。
- [Dashboard 图表设计](dashboard-chart-design.md) — **active proposal（进行中的提案）**；图表设计、指标语义、实现记录，以及项目状态中非阻塞质量验收待办的链接。

## 查阅架构决策

- [架构决策记录](decisions/) — 浏览决策集合；每份记录会标明自身状态。
- [ADR-021：Navigation API Observer](decisions/ADR-021-navigation-api-as-the-browser-observer.md) — **superseded（已取代）**，由 ADR-022 取代。
- [ADR-022：仅使用 Navigation API 的 Browser SDK](decisions/ADR-022-navigation-api-only-browser-sdk.md) — **accepted decision（已接受决策）**；通用浏览器 observer 边界。
- [ADR-023：协议版本升级须经明确批准](decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md) — **accepted decision（已接受决策）**；协议版本变更须经明确批准。
- [ADR-024：精简 SDK 与平台发布](decisions/ADR-024-simplified-sdk-and-platform-releases.md) — **accepted decision（已接受决策）**；其中的初始版本基线已由 ADR-025 取代。
- [ADR-025：项目版本基线 1.0.0](decisions/ADR-025-project-version-baseline-1.0.0.md) — **accepted decision（已接受决策）**；当前项目版本基线。
- [ADR-026：多架构容器镜像发布](decisions/ADR-026-multi-architecture-container-releases.md) — **accepted decision（已接受决策）**；x86-64 Linux 与 64-bit ARM 镜像发布方案。

## 查阅提案与已完成设计记录

- [静态产品站规划](static-product-site-plan.md) — **active proposal（进行中的提案）**；面向开发者的独立产品站。
- [Website 预览与 Dashboard 对齐](website-dashboard-preview-alignment-plan.md) — **completed record（已完成记录）**；实现和验收证据。
- [Traceleaf 品牌统一](traceleaf-brand-unification-plan.md) — **completed record（已完成记录）**；Logo 接入和术语规范证据。

## 浏览历史记录

- [开发归档](archive/README.md) — **historical（历史记录）**；已完成阶段、设计和验收记录。
- [代码重构归档](archive/refactoring/README.md) — **historical（历史记录）**；已关闭重构工作及验收证据。
