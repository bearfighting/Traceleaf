# Scripts 与 E2E 工具整理方案

> 状态：待实施。本文记录开发命令、数据库工具、容器构建和 E2E 测试的目标与验收步骤。本文中的目录和运行模式是当前方案，允许根据试验结果调整；每个阶段开始前先验证可行性，收益不足或复杂度不合适时更新本文再继续。当前功能冻结期间只做方案设计；开始实施前须确认发布冻结已解除或该工程整理已获维护者排期。

## 初衷

`scripts/` 最初主要承载本地开发启动和统一检查入口。现在它同时包含开发环境编排、数据库迁移测试、契约生成与校验、E2E 场景、E2E 环境准备、seed 辅助代码和这些脚本自己的单测。脚本名称虽有分类，但实现和依赖仍集中在同一层级，查找职责、复用公共逻辑和选择性运行测试都变得困难。

E2E 目前按功能拆成多个独立命令和 CI job。多个测试脚本各自组装 Compose 参数、启动服务、执行迁移、准备数据并在结束时删除 Compose project 和 PostgreSQL volume。Docker 编译缓存可以复用，但容器和数据库仍重复初始化。部分较大的 E2E 脚本还同时负责环境生命周期、seed、多个产品流程和浏览器断言。

数据库内容也分散在根目录 `migrations/`、`scripts/test-migrations.sh`、开发 seed 脚本和 E2E seed/helper 中。E2E 环境变量、端口、密钥、Compose profile 和测试参数由多个脚本分别管理。类似的 Compose 执行、就绪等待、错误诊断和清理代码重复出现。

容器构建也有类似的重复：Collector、Analytics API 和 Processor 的开发 Dockerfile 都复制整个 Rust workspace 的 Cargo manifest、创建占位源码并执行 `cargo fetch`；数据库迁移 Dockerfile 又维护一份近似流程。开发 Compose 在测试时经常调用 `up --build`，不同 E2E 脚本还各自触发环境构建。Dashboard Dockerfile 当前是面向开发的单阶段镜像，安装 workspace 依赖后由 Compose 挂载源码运行。

当前已经有一些缓存：E2E 使用 Cargo registry、target、Node modules 和 Next.js named volumes；Compose build 也能使用本机 Docker layer cache。但这些缓存不是同一层：E2E named volume 前缀由一组 Compose、Dockerfile 和 seed 输入的 hash 生成，输入变化会切到新缓存；GitHub Actions E2E job 使用独立 runner，当前 workflow 上传耗时/网络流量测量结果，没有配置可跨 runner 恢复的 BuildKit image cache。因而再次运行不一定每次都重新下载所有 crate，但缓存层分散、失效范围大，CI 和本机行为也不同。

## 优化目标

- 让目录和命令直接表达职责：数据库、开发环境、契约工具和测试代码各有明确归属。
- 保持现有 `pnpm dev`、`pnpm test`、`pnpm e2e:*` 等常用入口兼容，由薄入口转发到新的实现位置。
- E2E 环境由统一生命周期管理；普通 E2E 套件可以复用已经运行的服务，只按需重置数据库和加载场景数据。
- 按 API、Dashboard 页面、Onboarding、Router 等测试面选择性运行；CI 仍有明确的全量回归入口。
- 将开发 seed、E2E 场景数据和生产数据库迁移严格区分，不把开发数据写入正式环境。
- 明确分离依赖准备、开发热重载、release 编译、运行时镜像、migration 和 seed；通过稳定的 BuildKit 层与缓存减少重复下载和编译。
- 先度量冷/热构建耗时、网络流量、缓存命中和镜像大小，再决定合并 Dockerfile、调整 build context 或启用跨 CI 缓存。
- 不改变 API、事件协议、迁移语义、测试断言和产品行为。

## 目标目录

```text
db/
  migrations/                 # 所有环境共用、按顺序执行的正式 schema migration
  seeds/
    development/              # 明确 opt-in 的本地演示数据
    e2e/                      # E2E 初始化 SQL 或可复用的数据集
  tests/                      # migration 升级、幂等和回滚验证

tests/
  e2e/
    runner.mjs                # 选择 suite，协调环境生命周期和结果汇总
    suites/
      api/                    # Analytics API、Configuration、Site Management
      dashboard/               # Analytics 页面、Settings、定义管理
      onboarding/              # 空 Registry 到首次 Page View
      router/                  # Router adapter 与 Compose 场景
    support/
      compose.mjs              # Compose project、服务健康检查、诊断和生命周期
      environment.mjs          # E2E 环境变量、端口及随机凭据
      database.mjs             # 数据库 reset、migration 状态和 seed 调度
      browser.mjs              # Playwright browser/context 生命周期
      fixtures/                # 各 suite 的输入和期望结果
  unit/                       # 若非 package 私有测试，放跨 package 的工具测试

tooling/
  dev/                        # 本地开发启动、Compose profile 和开发 seed
  contracts/                  # 协议/配置校验、类型生成、parity 检查
  ci/                         # check、build、format 等统一流程编排

scripts/
  dev.sh                      # 保持常用命令兼容的薄入口
  test.sh
  build.sh
  format.sh

docker/
  rust-workspace.Dockerfile   # 公共依赖层与各 Rust 服务/dev/release targets
  dashboard.Dockerfile        # Node 依赖、开发和可选生产 targets
  dev-seed.Dockerfile         # 独立、显式调用的开发 seed 工具
```

目录是职责建议，不要求每个目录都必须存在独立 wrapper。package 内部专用的单测继续靠近 package；只有被多个测试套件共享的工具或集成流程才移到顶层 `tests/`。

## 关键设计

### 数据库迁移与 seed

Migration 是共享且有序的 schema 历史，不按 development、E2E、production 复制。不同环境的差别由连接目标、配置和 seed 决定。开发 seed 必须显式触发；E2E seed 只写入隔离测试数据库。

当前迁移由 `tools/db-migrator` 通过 `sqlx::migrate!("../../migrations")` 编译嵌入，Dockerfile、build script、迁移测试和文档也依赖根目录路径。移动目录时必须一次性更新这些引用并验证产物包含完整 migration 集合。已应用 migration 的编号、描述和 SQL 内容保持不变，以保留数据库中记录的 migration 身份；SQLx checksum 校验基于内容，不能通过改名或改路径绕过校验。

### E2E 环境复用与数据隔离

本地开发提供明确的 E2E 环境生命周期入口，例如 `pnpm e2e:up` 和 `pnpm e2e:down`。环境使用专属 Compose project、专属 PostgreSQL volume、独立端口和随机管理凭据，与日常开发环境完全隔离。`e2e:up` 生成的本地凭据和环境指纹保存在 git 忽略目录（例如 `.cache/e2e/`），限制文件权限；实施时将该运行状态目录加入 `.gitignore`。suite runner 读取同一份配置并校验 Compose project、服务配置和数据库目标。运行单个 suite 时如果环境已启动且配置匹配，就复用服务进程；不重复 build、migration 或删除 volume。

每个 suite 或需要隔离的场景通过数据库 helper 执行最小 reset，再加载自己的 fixture/seed。Migration 每次环境初始化执行一次，不在每个测试场景重复执行。涉及 onboarding、migration upgrade 或启动失败恢复的场景可要求全新数据库或专用 Compose project，因为这些测试本身需要验证空库/首次启动语义。

共享数据库的写入型 suite 默认串行运行，避免 reset/seed 与其他测试并发竞争。确需并行时，为每个 worker 分配独立 project、数据库和端口。失败时保留日志、Compose 状态和浏览器 trace；本地可选择保留运行环境便于排障，CI 在 `always()` 清理其 job 专属环境。`e2e:down` 应只删除命名明确的 E2E project，不接触开发 volume。

CI 的 GitHub Actions job 之间不能共享容器。可复用范围是每个 job 内的多个 suite。是否合并目前独立并行的 E2E job，应根据实测耗时和缓存数据决定，不能为了复用环境无条件牺牲 CI 并行度。

### 测试套件选择

统一 runner 提供稳定的 suite 选择方式，例如：

```bash
pnpm e2e --suite api
pnpm e2e --suite dashboard --suite onboarding
pnpm e2e --suite router
pnpm e2e --all
```

现有 `pnpm e2e:dashboard` 等命令可作为快捷别名，转发给统一 runner。测试按 API、Dashboard 页面/Settings、Onboarding 和 Router 组织；跨层场景保留为单独 workflow，避免为了目录整齐把不可分割的用户流程拆碎。Runner 应在启动前校验 suite 名称和必要环境变量，并在输出中说明选中的 suite、环境和数据库 reset 范围。

### 环境变量和公共逻辑

E2E 变量由一个模块集中定义默认值、校验规则和覆盖方式；敏感测试 token 随 E2E 环境生成，不写入仓库文件或日志，并随显式 `e2e:down` 清理。开发环境 `.env` 与 E2E 变量分别加载，不让某个 E2E 命令隐式继承开发 seed 或本地密钥。

把重复的 Compose 参数、命令执行、错误输出、健康等待、日志采集和清理移动到 `tests/e2e/support/compose.mjs`。Capability、Ingest Policy、Site 和事件数据准备按领域划分 seed helper。避免建一个接受大量回调和布尔 flag 的通用框架；公共 helper 应有窄而清楚的接口。

### Docker build stages 与缓存

Rust workspace 的开发镜像继续以仓库根目录作为 build context，因为 Cargo workspace 解析需要 workspace manifest、lockfile 和成员 manifest；不要为缩小 Dockerfile 表面内容而漏掉 workspace 依赖。将重复的 Rust manifest 复制、占位源码和 `cargo fetch` 提取为一个共享 Dockerfile 的依赖 stage，再提供服务专属的开发 target 和 release target。Compose 开发/E2E target 通过源码 bind mount 和持久 target/Cargo cache 增量编译；release target 在 builder stage 编译固定服务二进制，再将二进制和必要运行时文件复制到精简 runtime stage。避免每个开发镜像都重新维护一整份 workspace 依赖准备逻辑。

### 本机编译产物与容器内编译

当前 Collector、Processor、Analytics API 的 Compose command 使用 `cargo run`；`/workspace/target` 和 `/usr/local/cargo` 分别由 named volume 提供。Cargo 会按依赖和源码 fingerprint 做增量构建，源码未变化时不会完整重编译，但每次容器启动仍会调用 Cargo 检查目标；该 target cache 也不是仓库工作区的 `target/`。`scripts/build.sh` 已在本机运行 `cargo build --workspace`，因此本地 `target/debug/` 可能已有可复用的开发可执行文件。

建议提供两个明确的 Rust 开发运行模式，而不是让本机产物混入发布镜像：

- **Native 模式：** 在宿主机执行 `cargo build`（Cargo 自己判断新鲜度），由宿主机运行 `target/debug/{collector,processor,analytics-api}`；Compose 只负责 PostgreSQL 及其它容器化依赖。启动器集中设置 host 侧数据库地址、服务监听地址、API URL 和必要的端口映射。源代码变更后可由 `cargo run` 重用同一 target，或由 watcher 触发 build/restart。
- **Container 模式：** 保留 Docker Compose 内 Rust toolchain 与 target volume 的方式，作为无需本机 Rust 环境的跨平台 fallback，也用于验证容器开发流程。每个服务启动时使用持久缓存；不因容器被 recreate 就删除 target/Cargo volume。

将 release binary 直接复制进开发容器的 image 不会自动热重载：源码改变不会更新 image 内的文件，需要重建 image 并重启容器。热重载需要额外的 watcher/build/restart 流程，或直接由宿主机运行本机二进制；生产 runtime image 则不需要热重载。

Native 模式只能在宿主机和目标 runtime 兼容时运行（OS、CPU 架构、ABI/动态库）。不能把 macOS 或 Windows host binary 挂进 Linux runtime container，也不能把不匹配的本机 `target/` 拷进发布镜像。若 host/runtime 不兼容，选择 Container 模式。实施时先验证常见 Linux/macOS 开发环境上的可用性、环境变量与服务互连，并保留容易切换的模式入口；不应让 Native 模式成为 CI 或生产构建的隐式依赖。

**生产不复用开发机二进制。** 发布构建由锁定 Rust toolchain、Cargo.lock 和受控 Linux builder stage 从源码编译；生成的 release binary 进入独立、精简的 runtime image。Native 模式不会改变生产镜像来源、依赖边界或回滚方式。CI 应分别验证 workspace 编译/测试以及 release image 构建；本机 `target/debug` 只用于本地开发。

`db-migrator` 已有 builder/runtime multi-stage，应继续作为独立服务镜像和专用 build target，但共享 Rust workspace 的依赖 stage；migration 在数据库初始化时执行，不混进 API/Collector/Processor 的运行镜像。开发 seed 也保持为显式的一次性 Compose service/command，绝不在 Docker build 时访问数据库或自动写 seed。Dashboard 可区分 deps、dev 和 production build/runtime targets；当前开发/E2E bind-mount 流程先保留，生产 target 只有在确实需要发布静态 Dashboard 镜像时再启用。

依赖下载层只依赖 Rust/Node 版本、lockfile 和依赖 manifest；复制应用源码应放在依赖层之后，避免普通源码编辑导致依赖重新下载。BuildKit cache mount 用于本地 Cargo registry/git 与编译缓存；CI 选择支持的 buildx/Compose 流程配置 `cache-from`/`cache-to`，并按稳定 cache key 恢复，而不是将整个 Docker daemon 或运行中的数据库打包缓存。若 `.dockerignore` 缩小 context，需先验证所有目标的 `COPY`、Rust `include_str!` 和生成步骤仍可用。

先用 Docker build 输出、网络字节统计和缓存目录体积确认实际瓶颈。如果抽取共享 Cargo stage 已获得可观复用，不额外引入 `cargo-chef` 等依赖；只有 manifest-only layer 仍不能满足实测需求时才评估它。CI job 可按测试面继续并行，但同一 job 内的 suites 共用该 job 启动的一次 Compose 环境和已构建镜像。

## 实施步骤与验收

### 1. 建立当前命令和依赖清单

- 为每个 package script、CI job 和脚本记录用途、依赖服务、数据库写入范围、环境变量、是否需要浏览器及 cleanup 行为。
- 标出可以共用环境的 suite，以及必须使用空库/独立 project 的启动与 migration 场景。
- 记录 Docker build context 大小、Rust/Node 依赖下载、镜像 build、容器启动、migration、测试、网络流量、缓存体积和总耗时，并区分冷构建与热构建。

**验收：** 清单覆盖所有 `e2e:*`、`test:integration`、migration、dev seed、Dockerfile、Compose build target 和 CI 引用；冷/热构建基线可重复测量。

### 2. 先移动文件，不改变命令行为

- 建立 `db/`、`tests/e2e/`、`tooling/` 目录并按职责迁移实现。
- 更新 `tools/db-migrator` 的嵌入路径、build script、Dockerfile、migration tests、Compose 文件、格式检查清单和文档。
- E2E fixtures 与各自 suite 放在测试目录；正式协议 fixtures 仍留在 `protocol/`。
- 根 `scripts/` 暂时保留兼容 wrapper，package.json 和 CI 命令不必同一提交全部重写。

**验收：** `pnpm check`、migration 单测和 migration 集成测试通过；开发启动、显式 seed、现有 E2E 命令与 CI 引用仍可运行。

### 3. 整理 Docker build stages 和依赖缓存

- 合并重复 Rust workspace dependency layer；Compose 开发/E2E 显式选择 dev target，发布镜像选择 release builder/runtime targets。
- 实测 Native Rust 模式：复用本机 `target/debug` 启动 Collector、Processor 和 Analytics API；保留 Container 模式处理无本机 toolchain 或 host/runtime 不兼容的情形。
- 保留独立 migration 和 seed 工具；依赖下载、编译、数据库 migration 与 seed 是不同操作，不在 image build 阶段连接数据库。
- 评估 Node Dashboard deps/dev/production targets；依赖 manifest 与 lockfile 保持在源码 COPY 之前。
- 减小 `.dockerignore`/build context 中确认不参与构建的内容，并配置本地 BuildKit 缓存；再为 CI 选择跨 runner cache 导入/导出方式。
- E2E 环境热启动时不默认 `--build`；通过明确的 build/update 命令或依赖指纹变化触发构建。

**验收：** Rust 服务共用依赖准备层；仅改普通源码不会触发依赖下载层失效；Native 模式使用本机 Cargo target 启动服务，Container fallback 仍可用；冷/热构建测量显示下载量和耗时改善；release、migration 镜像各自可构建且职责明确。

如果 Native 模式需要大量平台专用配置，或实测启动/构建收益不明显，可先保留 Container 模式并优化持久 Cargo target/Cargo registry 与 BuildKit cache；如果跨 CI BuildKit 缓存维护成本超过收益，可仅保留本地缓存。调整方案时同步更新本文中的目标与验收条件。

### 4. 抽取 E2E 环境和数据 helper

- 统一 Compose project 配置、环境变量解析、健康检查、诊断、缓存准备和清理。
- 统一数据库 reset 的安全边界；区分全量 reset、业务数据 reset 和迁移专用空库，不再由各套件内联任意 TRUNCATE 列表。
- 合并重复 seed 逻辑，但保留不同 suite 所需的明确数据语义。

**验收：** 多个 suite 使用同一 support 模块；reset 只能作用于专用 E2E 数据库；新旧 E2E 断言结果一致。

### 5. 实现可复用的 E2E 生命周期和 suite flags

- 增加本地显式 up/down 命令和统一 suite runner；已运行且配置匹配时跳过 Compose 重启和重复 migration。
- 支持 `--suite`、重复选择多个 suite、`--all`、`--keep-environment` 等必要选项，并对未知选项失败退出。
- 每个 suite 开始时按需 reset/seed；suite 之间串行。首次启动、migration upgrade、dev startup 等特殊场景保留隔离环境。
- CI 每个 job 启动一次环境并运行该 job 选中的 suite，在成功和失败路径都执行清理。

**验收：** 同一运行环境连续执行两个会写数据库的 suite 均通过；重复运行不重建容器和 volume；执行后可验证清理不会触及 dev project；失败时有完整诊断。

### 6. 更新命令、CI 和使用文档

- 保留常用 pnpm 命令作为兼容入口，逐步切换实现路径。
- CI 在保持隔离的前提下按实测决定哪些 suites 合并到同一 job；比较总耗时、并行耗时和缓存命中情况。
- 更新 `getting-started.md`，说明 E2E 环境启动、reset、保留和关闭方式，以及每条 suite 的范围。
- 删除确认无调用方的旧实现，避免双维护；保留必要的 wrapper 时注明其兼容用途。

**验收：** 本地文档命令可直接执行；CI 全量 E2E 通过；不存在旧脚本路径引用或重复环境生命周期实现；记录优化前后耗时。

## 完成定义

- 脚本目录按职责组织，`scripts/` 主要承担稳定入口和必要的流程 wrapper。
- Migration、开发 seed、E2E seed 与 E2E fixtures 有清晰边界。
- Rust workspace 依赖层不在每个服务 Dockerfile 中重复定义；开发、release、migration 和 seed 镜像职责分明。
- 本机 Rust debug binary 只用于开发；生产 release binary 始终从受控 builder stage 生成并进入独立 runtime image。
- 本地与 CI 的 Docker 缓存范围、失效条件、镜像 build 时机均有记录和耗时/流量数据支撑。
- E2E 可按 suite 选择；普通 suite 可以共享运行中的服务并按需 reset 数据。
- 空库、migration、启动故障等特殊验收仍有明确隔离流程。
- 所有现有产品断言、API/协议语义和 migration checksum 不变。
- `pnpm check`、`pnpm test`、migration/集成测试和完整 E2E 均通过，CI 清理及本地排障方式有实际验证。
