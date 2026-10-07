# Migration harness 重构试点

本记录对应代码重构 Checklist 工作包 6.4。保留 `pnpm test:migrations` 入口、根 package script、CI 顺序、迁移文件和数据库 schema。

## 场景映射

| 场景                         | 内部脚本                                  | 输入与职责                                                                                                                                          |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current history              | `db/tests/migration-current-history.sh`   | 对传入的 `DATABASE_URL` 连续运行迁移，执行迁移历史集成回归。                                                                                        |
| Clean install                | `db/tests/migration-clean-install.sh`     | 对入口创建的 clean database 两次运行迁移并执行迁移历史回归。                                                                                        |
| Upgrade 与 legacy conversion | `db/tests/migration-upgrade-behavior.sh`  | 从指定历史版本开始，覆盖旧 feature flags 转换、冲突导致的原子回滚、Site Registry 导入、配置与 Origin/audit 数据行为。目标库由 `DATABASE_URL` 指定。 |
| Schema assertions            | `db/tests/migration-schema-assertions.sh` | 依次验证 clean、upgrade、current 数据库中的 migration history、表、函数、索引及约束。三个数据库 URL 由入口作为参数传入。                            |

`db/tests/test-migrations.sh` 仍负责环境检查、临时数据库命名和 URL 派生、数据库创建、场景调用顺序以及 `EXIT` cleanup trap。所有临时数据库清理仍由同一 trap 执行，场景脚本不创建或删除数据库。

`pnpm test:integration` 保持独立：它只在迁移后的数据库上运行 Collector、Processor 和 Analytics API 行为 suites。`.github/workflows/quality.yml` 仍先调用 `pnpm test:migrations`，再调用 `pnpm test:integration`；两类 assertions 和数据库生命周期没有合并。

## 验收状态

`bash -n` 对入口和四个场景脚本通过。`package.json`、integration runner 和 CI workflow 的入口及调用顺序保持不变。6.4 切片时未能在本地执行数据库 suites；6.5 和 6.6 已在独立 PostgreSQL 18.6 上完成 current/clean/upgrade、integration、失败原子回滚和临时库清理验证，详见 [E2E / contract pilot 的工作包 6.5 验收](./code-refactoring-e2e-contract-pilot.md#工作包-65-分切片验证与回归2026-10-07)及[工作包 6.6 验收](./code-refactoring-e2e-contract-pilot.md#工作包-66-整体验收与关闭2026-10-07)。工作包 6 已关闭。
