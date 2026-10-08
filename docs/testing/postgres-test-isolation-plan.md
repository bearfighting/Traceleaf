# PostgreSQL 测试环境隔离与分层测试计划

> 状态：已实施。当前命令和资源生命周期以本文配套的脚本、Compose 配置及运维指南为准。

## 目标

让 Collector、Processor 和 Analytics API 的 PostgreSQL 集成测试可以单独、快速、安全地启动和运行，同时保持 E2E 数据库与生产数据库相互隔离。

目标测试层次：

| 层次         | 验证内容                                                      | PostgreSQL 生命周期                                      |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| 单元测试     | 领域规则、校验、错误映射、application service/fake repository | 不启动 PostgreSQL                                        |
| 组件集成测试 | 单个后端的 SQL、事务、迁移兼容、HTTP 与数据库交互             | 复用专用测试 PostgreSQL 服务；每次运行使用独立临时数据库 |
| 端到端测试   | Collector → Processor → Analytics API 及完整业务流程          | 独立 Compose project、独立 volume，运行后清理            |
| 生产环境     | 真实部署数据                                                  | 独立主机/网络、凭证、secret 来源和备份策略               |

## 当前问题

1. `compose.yaml` 中 Collector、Processor、Analytics API 默认连接同一个 `analytics` 数据库；开发服务使用 `COLLECTOR_DATABASE_URL` 覆盖默认值。
2. PostgreSQL 测试大多标记为 ignored。`pnpm test:integration` 要求调用者预先提供 `DATABASE_URL`，然后执行迁移和各 crate 的 ignored 测试；脚本本身不启动或隔离数据库。
3. 统一 integration 脚本把三个后端的数据库测试顺序串在同一个目标数据库上，没有独立的组件入口。测试清理/写入逻辑可能互相影响。
4. integration 入口没有验证目标 host、数据库名或环境标签。若传入不恰当的 URL，迁移和测试可能落到开发库，甚至错误地落到生产库。
5. E2E 已使用独立 Compose project、端口和 volume，但一次分析 E2E 会启动并等待多个服务、构建镜像、迁移并装载 fixtures；其启动成本不适合作为每个后端改动后的快速反馈环。
6. 目前没有统一入口让开发者只运行一个组件的 PostgreSQL 测试，也没有明确的测试 PostgreSQL 启动/停止、失败清理和并发运行约定。

## 目标隔离模型

### 专用测试 PostgreSQL

- 新增独立的测试 Compose 配置（建议 `compose.test.yaml`），只启动 PostgreSQL，不启动业务服务。
- 使用专用 Compose project 名、专用 host port（例如 `55432`）和专用 volume；不可复用开发环境或 E2E 的 project/volume。
- 默认只绑定 loopback 地址。测试凭证使用专用值，不读取生产 secret。
- 本地可以保留这个 PostgreSQL 服务运行，避免每次测试都重新创建容器；测试数据不长期共用。

### 每次组件测试使用临时数据库

- 组件测试命令通过专用测试管理连接在测试 PostgreSQL 实例中创建唯一的临时数据库，例如 `analytics_collector_test_<run-id>`、`analytics_processor_test_<run-id>`、`analytics_api_test_<run-id>`。
- 每个临时数据库只由一次命令运行使用；该运行只对它执行迁移、seed 和测试。
- 在成功或失败退出时，只删除带有受控测试前缀且由当前运行创建的数据库。清理逻辑不得接受任意数据库名，也不得执行宽泛的 `DROP DATABASE`。
- 使用唯一 run ID 支持不同组件及相同组件的测试并发运行。单次 Rust 测试进程仍可按现有需要限制 test threads。
- 若建库或清理无法安全确认目标归属，命令应停止并保留诊断信息，而不是尝试清理未知数据库。

### E2E 与生产边界

- 保留现有 E2E runner 的随机/独立 project、独立端口、独立 volume、迁移、fixtures 与清理流程；组件测试不得借用 E2E 数据库。
- E2E 可以继续针对完整后端链路执行数据重置，因为其目标数据库属于本次 E2E project。
- 生产数据库不能由上述本地测试 Compose project 暴露或发现；生产 URL/凭证不得通过测试默认值、共享 `.env` 或测试命令继承。
- 测试入口需拒绝明显非测试目标：非 loopback 测试 host、数据库名不符合测试前缀、缺少显式 `DATABASE_URL`/test database URL，或匹配已配置的生产拒绝规则。拒绝时打印安全的目标摘要，不打印密码或完整 URL。

## 命令接口规划

名称可在实现时按现有 package script 命名习惯调整，但每条命令的范围应保持清晰：

| 命令                                                | 行为                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                         | 快速单元测试，不要求 Docker 或 PostgreSQL                                                                   |
| `pnpm test:collector:postgres`                      | 确保测试 PostgreSQL 可用，创建 Collector 临时库、迁移并运行 Collector PostgreSQL 集成测试，最后删除该临时库 |
| `pnpm test:processor:postgres`                      | 同上，仅运行 Processor PostgreSQL 集成测试                                                                  |
| `pnpm test:analytics-api:postgres`                  | 同上，仅运行 Analytics API PostgreSQL/HTTP 集成测试                                                         |
| `pnpm test:integration`                             | 依次调用上述组件入口；可配置是否并行，但并行时必须保证各运行使用独立临时数据库                              |
| `pnpm e2e:<suite>`                                  | 保持现有完整 E2E project 和数据库生命周期，不连接组件测试 PostgreSQL                                        |
| `pnpm test:postgres:up` / `pnpm test:postgres:down` | 可选的显式测试 PostgreSQL 生命周期管理；down 只停止专用 test project，不删除开发或 E2E 资源                 |

纯 Rust 测试仍可直接使用 `cargo test -p <package>`；需要 PostgreSQL 的 ignored 测试由上述安全入口显式调用 `--ignored`。不要让普通 `cargo test` 隐式连接用户当前 shell 中任意的 `DATABASE_URL`。

## 实施步骤

1. **盘点和分类测试**：为三个后端列出纯单元测试、fake/in-memory 测试、需要迁移的 PostgreSQL 集成测试和跨服务 E2E 测试；将数据库测试归属到具体组件命令。
2. **新增测试 Compose 配置**：定义专用 PostgreSQL、loopback 端口、健康检查、项目和 volume 约定；验证它与开发及 E2E Compose 合并时不会意外共享资源。
3. **实现临时测试库生命周期工具**：创建唯一测试数据库、生成仅指向该库的 URL、执行迁移/测试、成功或失败后仅清理当前运行创建的数据库；对并发和中断情况定义可恢复行为。
4. **增加目标保护**：在运行迁移或测试前检查协议、host、数据库名和测试前缀；阻断任意外部/生产目标并确保错误输出脱敏。
5. **拆分组件测试入口**：分别为 Collector、Processor、Analytics API 调用各自的 ignored PostgreSQL 测试；保留一个统一 `test:integration` 聚合入口。
6. **补充自动化检查**：为生命周期脚本添加测试，验证 URL 拒绝规则、唯一库名、并行隔离、失败清理、只清理当前运行数据库及敏感信息脱敏。
7. **更新开发文档与 CI**：记录命令、依赖、端口、测试库命名、故障排查和清理方式；CI 使用同一组件入口，不复用生产或 E2E 数据库。
8. **验证隔离与速度**：分别运行三个组件数据库测试、并发运行至少两个组件测试、运行至少一个完整 E2E；检查测试 Compose project/volume 和 E2E project/volume 不同，并确认所有临时数据库与本次资源清理完成。

## 验收条件

- 不启动 PostgreSQL 时，纯单元测试能独立通过。
- 首次运行可自动准备专用测试 PostgreSQL；后续组件测试复用服务，不必重新构建/启动完整后端栈。
- 三个组件能单独执行 PostgreSQL 集成测试，且每次运行获得独立数据库；互相并发时不会共享测试数据。
- 迁移、fixtures 和清理只作用于本次运行创建的测试数据库。
- 缺失测试 URL、非测试库名、非允许 host 或生产目标会在执行迁移前失败，并且不泄露 secret。
- E2E 继续创建/使用自己的 project 和 volume；组件测试结束不会影响 E2E 数据，E2E 清理不会影响组件测试 PostgreSQL。
- 开发、测试、E2E 和生产的数据库 host/凭证/存储生命周期有文档说明，且没有共享默认 secret 或 volume。
- CI 与本地使用相同入口，日志能指出失败组件、测试数据库运行 ID 和安全的清理状态。

## 非目标

- 不把 PostgreSQL 替换成 SQLite 或 mock 来验证 SQL、事务和迁移行为。
- 不改变生产 schema、业务迁移内容、API 契约或服务的数据库职责。
- 不为组件集成测试启动完整 E2E 服务栈。
- 不让测试命令自动连接开发或生产数据库，也不复用 E2E volume 来节省启动成本。
