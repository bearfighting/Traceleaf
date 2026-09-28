# Phase 7 PR7 — MVP 功能验收记录

> Status: Complete. Phase 7 功能验收于 2026-09-24 关闭；真实流量 Geo staging 验证待产品实际运行后安排，不阻塞 MVP 完成。
> Last reviewed: 2026-09-24

PR7 是 Phase 7 的最终功能验收，不代表 Release Readiness。Firefox/WebKit 完整浏览器矩阵、真实流量 Geo staging、生产恢复演练和 SDK 独立发布均不属于 MVP 门槛；相关运维和发布验证待产品实际运行后安排。

## 验收证据

| 范围                                            | 当前证据                                                                                                                                                                                        | 状态                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Protocol、capability 与 API contracts           | 2026-09-24 protocol、capability、HTTP（30 fixtures）、contract namespace、Analytics API contract（11 fixtures）和 analytics definitions validators 全部通过；状态与 invalid fixtures 已复核     | 验证通过                                       |
| Page View、Visitor、Session、Dimensions 基线    | 2026-09-24 `node scripts/e2e-analytics.mjs`：10/10 fixtures 通过；Rust workspace tests 通过                                                                                                     | Analytics E2E 通过                             |
| React Router、TanStack Router observer contract | 包目录 Vitest：React Router 3/3、TanStack Router 5/5、Router facade 8/8 通过                                                                                                                    | 已通过                                         |
| 三种 Router 的真实浏览器导航                    | `pnpm e2e:router-adapters` 已通过 Next、React Router 和 TanStack Router 的导航验证                                                                                                              | 浏览器 E2E 通过                                |
| Custom Events、Web Vitals、Conversion/Funnel    | 2026-09-24 Analytics E2E 分别通过 `custom-events`、`web-vitals` fixture；Conversion/Funnel fixtures 与 Processor/API 单测已有能力级覆盖                                                         | Analytics E2E 通过                             |
| Geo country、unknown、版本、幂等及隐私          | 合成 `GeoLite2-Country-Test.mmdb` Analytics E2E、国家报表及 Dashboard 测试覆盖；新鲜度、站点隔离、空结果和无 IP 隐私断言已加入                                                                  | 合成数据验收通过；真实数据评估见 ADR-011       |
| Dashboard 状态                                  | `apps/dashboard` Vitest：18 个文件、82 项通过；2026-09-24 `node scripts/e2e-dashboard.mjs` 的 14 个浏览器 workflow checks 全部通过，包含 Geo attribution、empty/freshness、API error            | Dashboard 单测与浏览器 E2E 通过                |
| Rust workspace                                  | `cargo test --workspace` 通过；专项 PostgreSQL 测试在隔离临时数据库完成：迁移通过，Collector 5、Phase 6 migration 1、Processor 14、Analytics API 6 项通过                                       | workspace 与专项 DB 回归通过                   |
| DB-IP City Lite 本地 MMDB 验证与 staging 评估   | 本地 parser smoke：`DBIP-City-Lite-1788226681`、SHA-256 已记录，受控地址分别解析为 US / unknown；官方 September 2026 MD5/SHA-1 checksum 已匹配；staging 部署、更新/回滚、流量聚合覆盖率尚未完成 | 本地验证通过；staging 评估待产品实际运行后安排 |

## Phase 7 关闭及后续部署跟进

Phase 7 功能验收已关闭。产品实际运行后，由部署方在 staging 挂载已校验的 DB-IP City Lite，验证 Collector 启动、受控 country/unknown 查询、离线替换与回滚；在代表性流量观察期记录 Page View 总数、已解析国家数和 `unknown` 数，并复核数据库与应用日志无原始 IP。该评估不属于 MVP 退出条件。只回传聚合数，不记录或发送 IP。
staging 结果在产品实际运行后评估，并作为 Geo PR2 是否重启的前置证据；它不是 MVP 退出条件。

## Geo PR2 决定

Geo PR2（region/city）继续延期。当前 country-only 合成数据验证不能说明真实数据的覆盖质量、运营维护成本或国家级能力的产品价值。只有 staging 评估完成、country-only 需求得到验证，并重新审查精度与隐私边界后，才重新决定是否启动 PR2。
