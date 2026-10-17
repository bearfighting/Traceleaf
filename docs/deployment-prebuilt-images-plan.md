# 预构建容器镜像部署计划

## 状态与目标

- 状态：代码、CI 与部署文档已实施；首次 GHCR 正式发布及 Pi / x86-64 实机验收仍是发布门禁
- 适用部署：以 x86-64 Linux 主机为主要目标，并支持 Raspberry Pi 64-bit ARM 作为次要部署目标和当前验证环境。
- 目标：在 CI 或构建机生成并发布同一版本的 `linux/amd64` 和 `linux/arm64` 服务镜像；部署主机只拉取镜像并运行服务，不安装 Rust、Node.js、pnpm 或构建项目源码。
- 镜像仓库：GitHub Container Registry（GHCR），默认私有镜像。

当前明确的部署目标是 `linux/amd64`（x86-64 Linux）和 `linux/arm64`（Raspberry Pi 64-bit ARM）；前者是长期主要目标，后者用于当前部署验证。它们是当前已知环境对应的首批镜像平台，不构成对 Web 应用源码、协议或服务设计的永久架构限制，也不表示项目拒绝其他兼容平台。后续出现新的部署环境时，可扩展镜像 manifest 的 OS/架构平台集合；只有为该平台构建并通过对应运行验收后，才将其列为已支持目标。当前两个平台使用相同镜像名和版本标签，OCI 多架构 manifest 根据运行主机架构选择镜像变体；每次平台版本发布都必须继续包含并验证当前已支持的平台。

镜像分发与部署约束记录在 [ADR-026](decisions/ADR-026-multi-architecture-container-releases.md)。

本计划将镜像构建与 Pi 上的服务运行分开。Rust 运行镜像继续只包含对应服务的可执行文件和运行依赖；Dashboard 使用 Next.js standalone 输出，减少完整 monorepo `node_modules` 进入运行镜像。

## 当前状态

- `compose.deploy.yaml` 通过 GHCR 拉取所有应用镜像；`pnpm deploy:up` 先 pull 再 up，不触发构建。
- `docker/rust-workspace.Dockerfile` 使用多阶段构建：release builder 构建 Rust workspace，运行阶段按服务复制可执行文件。所有 Rust 服务共享同一 Dockerfile 和 builder 阶段，构建缓存可复用。
- Rust 运行镜像基于 Debian slim，并安装 CA 证书与 `curl`。健康检查依赖 `curl`；审计清理服务还依赖 shell 和 `sleep`。本计划不要求立即改成 `scratch` 或纯静态镜像。
- `docker/dashboard-deploy.Dockerfile` 构建 Next.js standalone 输出；运行阶段只复制 standalone server、静态资源和 public 资源。
- 发布 workflow 在 tag 完整验证后构建候选 multi-arch manifest，运行双架构原生 Compose smoke，再按 digest 幂等晋升 SHA 和版本标签。首次正式 GHCR 发布尚未执行。
- 部署还需要 PostgreSQL 数据卷、`.env.deploy` 和外置的 GeoIP MMDB 文件；这些不进入应用镜像。

## 目标镜像

| 镜像                                      | 运行内容                                               | Compose 服务                    |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| `ghcr.io/<owner>/traceleaf-collector`     | Collector 可执行文件及运行依赖                         | `collector`                     |
| `ghcr.io/<owner>/traceleaf-processor`     | Processor 可执行文件及运行依赖                         | `processor`                     |
| `ghcr.io/<owner>/traceleaf-analytics-api` | Analytics API 可执行文件及运行依赖                     | `analytics-api`                 |
| `ghcr.io/<owner>/traceleaf-db-tools`      | `db-migrator` 可执行文件及运行依赖                     | `db-migrate`、`db-audit-purger` |
| `ghcr.io/<owner>/traceleaf-dashboard`     | Next.js standalone server、静态资源及 Node.js 运行环境 | `dashboard`                     |

PostgreSQL 继续使用锁定版本的官方镜像。Website 和开发 Playground 不属于当前 Pi 部署栈；Website 静态导出可以另行评估。

平台版本和 Git tag 遵循[版本与发布流程](versioning-and-release-process.md)：例如 Git tag `v1.0.0` 对应五个镜像的 `v1.0.0` 标签。另推送 `sha-<commit>` 候选标签以便按源码提交定位产物。Compose 使用必填的 `TRACELEAF_IMAGE_TAG` 选择整套应用镜像，不依赖 `latest`。生产部署使用已验收的 `vX.Y.Z` 标签；部署记录保存各镜像实际解析到的 digest 作审计和故障定位，回滚时选择上一版已验收的 `vX.Y.Z` 标签。

## 发布与架构验收约定

- Git tag `vX.Y.Z` 是唯一的平台版本来源；镜像版本和 SHA 标签都从该 tag 对应的 commit 生成，不为单个服务建立独立版本流。
- 现有 tag workflow 在 Git `v*` tag 创建后触发；因此 Git tag 在完整验证开始前已存在。本门禁控制 GHCR 正式版本标签和 GitHub Release：工作流按 `full-validation` → 发布本次运行专属候选镜像 → 两架构 smoke check → 给同一 manifest 添加 GHCR `sha-<commit>` 与 `vX.Y.Z` 标签的顺序执行；GitHub Release 仅在工作流全部成功后手动创建。
- PR、定时验证和非发布 tag 不推送镜像。发布 job 依赖现有 `full-validation` reusable workflow 成功，并仅在 Git `v*` tag 触发。
- 首批 CI 构建同时产出 `linux/amd64` 与 `linux/arm64` manifest。平台集合由发布 workflow 的单一配置维护，不在应用代码中添加架构专用分支；增加新平台时同步加入构建矩阵和原生运行验收。在 `ubuntu-24.04` 与 `ubuntu-24.04-arm` 原生 runner 上分别拉取并运行验收，不用 QEMU 结果代替运行验收。两种 GitHub-hosted runner label 均须在实施时确认仓库计划和计费可用性。
- 每次 workflow run 先推送本次专属候选标签 `candidate-<commit>-<run_id>-<run_attempt>`。两种架构的隔离 Compose smoke check 都通过后，工作流才将候选 manifest 关联到 GHCR `sha-<commit>` 与 `vX.Y.Z` 标签，不重新构建镜像。失败时不生成这两个稳定标签；候选镜像可保留用于诊断，清理前须确认没有仍在运行的验收 job。
- GitHub tag event 发生时 Git `vX.Y.Z` tag 已存在。发布流程控制的是 GHCR 镜像 tag 和 GitHub Release，不声称能阻止 Git tag 的创建。
- GitHub Container Registry 不提供本计划所依赖的 tag 不可变保证。发布 workflow 在创建稳定 SHA/版本标签前检查目标是否已存在：若已指向同一 manifest 则视为幂等成功，若指向不同内容则失败，禁止重写已发布内容。具有 `packages: write` 的发布 job 是唯一日常写入者；人工管理员仍可能修改包标签。digest 记录用于审计，Compose 部署和回滚使用受发布流程保护的版本标签。
- Smoke check 必须使用候选镜像启动隔离 Compose 栈，覆盖空 PostgreSQL 的 migration、Collector/Processor/Analytics API/Dashboard 启动和 healthcheck，以及 DB audit purge 命令可运行。Collector 所需 GeoIP MMDB 使用仓库测试 fixture 临时挂载，不进入镜像。
- 镜像 namespace 使用小写的 `github.repository_owner`；镜像加上 `org.opencontainers.image.source`、平台版本和 commit 元数据。首次由 workflow 发布以关联 GHCR 包与源码仓库，并确认 GitHub Actions 对这些包有写入权限。
- 镜像仓库维持私有时，CI 使用只具备所需 `packages: write` 权限的 `GITHUB_TOKEN`；部署主机使用仅能读取包的凭据，并将凭据保存在 Docker credential store/helper 中。GHCR 首次发布默认私有；从 workflow 发布并添加 `org.opencontainers.image.source` 标签以关联源码仓库，再确认包的 Actions 权限和部署主体的读取权限。[GHCR 容器注册表文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

发布 job 权限按职责拆分：候选构建和稳定标签 promotion job 仅有 `contents: read`、`packages: write`；AMD64/ARM64 smoke job 仅有拉取所需的 `packages: read`；现有 quality workflow 保持 `contents: read`。workflow 需 checkout 被验证的 tag commit；不得从分支头部 checkout。

## 实施阶段

### 1. 精简 Dashboard 运行产物

- 在 `apps/dashboard/next.config.ts` 启用 Next.js `output: "standalone"`。
- 配置 monorepo 文件追踪根目录，使构建能收集 Dashboard 从 workspace 引用的运行期文件。
- 更新 `docker/dashboard-deploy.Dockerfile`：构建阶段仍安装锁文件中的 workspace 依赖并构建 Dashboard；运行阶段只复制 standalone 输出、`.next/static` 和需要的 `public` 资源。
- 使用 standalone 生成的 `server.js` 启动服务，保留当前 `HOSTNAME`、`PORT` 和运行时服务端环境变量行为。
- 检查运行镜像不再复制完整根目录及 Dashboard `node_modules`。

Next.js standalone 会依据构建追踪生成服务器和运行依赖；静态资源需要显式放入 standalone 目录。Dashboard 当前使用 Next.js 16，实施时应先阅读 `apps/dashboard/node_modules/next/dist/docs/` 中对应版本的本地配置指南，并以此确认 monorepo tracing 和 runtime 行为。参考：[Next.js Output 配置](https://nextjs.org/docs/app/api-reference/config/next-config-js)。

### 2. 增加多架构镜像发布工作流

- 扩展 `.github/workflows/ci.yml`：发布 job 依赖 tag 触发的 `full-validation` 成功；PR 与 nightly workflow 不推送镜像。
- 发布 job 使用 `GITHUB_TOKEN` 登录 GHCR，并只授予该 job 所需的 `packages: write` 权限；其他 job 保持只读权限。
- 在 PR CI 增加部署 Compose 静态检查，使用非敏感 dummy env 值执行 `docker compose ... config --quiet`；验证五个应用服务只引用 GHCR `image`、使用必填 namespace/tag，并且 Compose 配置中没有应用服务 `build` 项。
- 使用 Docker Buildx 为全部应用镜像生成同时包含 `linux/amd64` 和 `linux/arm64` 的 manifest；GitHub Actions 使用 `ubuntu-24.04` 与 `ubuntu-24.04-arm` 原生 runner 做运行验收。GitHub 当前列出这两个 hosted runner label；私有仓库的可用性和计费须在实施前确认。[GitHub-hosted runner 规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。若 hosted runner 对仓库不可用，再采用具有相同 Docker/Compose 能力的自托管原生 runner，并记录维护责任。
- 为 Collector、Processor、Analytics API、DB tools 和 Dashboard 生成独立运行镜像；发布验收应覆盖每个镜像的两种架构。
- 使用 `docker buildx bake` 或等价的单次 Buildx 调度构建五个镜像，避免分别触发五次完整 workspace 构建；Rust 目标共享 release builder 层，Rust `target` cache mount 按架构隔离，GitHub Actions BuildKit cache scope 按镜像隔离，避免并发导出互相覆盖。DB tools 只发布一次并由迁移和清理任务共用。
- 为镜像添加仓库来源、平台版本和提交 SHA 等 OCI 元数据；使用 BuildKit 缓存减少后续发布耗时。
- 镜像只包含程序和非敏感运行文件；数据库密码、管理员 token、GeoIP 数据库不进入构建参数或镜像层。
- 为每次 workflow run 生成不同的候选 tag `candidate-<commit>-<run_id>-<run_attempt>`，避免未验收候选互相覆盖。
- 发布前检查 `sha-<commit>` 与 `vX.Y.Z` GHCR 标签：已存在且 manifest digest 相同则幂等跳过；已存在但 digest 不同则失败。不得重新构建后覆盖候选或已发布版本。
- 两种架构的隔离 Compose smoke check 全部成功后，才把候选的同一多架构 manifest 添加为 `sha-<commit>` 和 `vX.Y.Z`。记录每个服务的版本标签、commit 与 manifest digest。
- 对已部分完成的 promotion 重跑时，逐镜像比较已有 SHA/版本 tag 的 manifest digest；相同则继续，不同则停止并人工处理，不覆盖。
- 发布 job 的恢复操作使用 GitHub Actions 的“Re-run failed jobs”，沿用已成功生成并 smoke-tested 的候选镜像 digest。不得用“Re-run all jobs”重建同一 Git tag 的候选后尝试覆盖已晋升的稳定 tag；若必须重建，需先查明原候选和稳定标签状态，再按未发布版本的人工恢复步骤处理。

Docker Buildx 可为同一镜像发布不同目标平台，容器运行时会按宿主机架构选取对应变体。[Docker 多平台构建](https://docs.docker.com/build/building/multi-platform/)。GHCR 支持由 GitHub Actions 使用 `GITHUB_TOKEN` 发布镜像；发布 workflow 需要相应包写入权限。[GitHub 容器镜像发布](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)

### 3. 将部署 Compose 改为拉取多架构镜像

- `compose.deploy.yaml` 中所有应用服务使用 GHCR `image` 引用。
- 五个应用服务引用固定 namespace 下各自的 GHCR 镜像，并使用同一个必填的 `TRACELEAF_IMAGE_TAG` 选择平台版本；namespace 使用必填 `TRACELEAF_IMAGE_NAMESPACE`，未设置任一变量时 Compose 配置必须失败。PostgreSQL 继续使用当前锁定的官方镜像版本。
- 将端口绑定变量从 `PI_LAN_IP` 改为通用 `DEPLOYMENT_HOST_IP`；保留显式绑定地址，避免无意暴露到所有网卡。Pi 示例填 LAN 地址；其他 x86-64 Linux 主机按其防火墙和访问策略设置。
- 更新 `.env.deploy.example`，加入 `TRACELEAF_IMAGE_NAMESPACE`、`TRACELEAF_IMAGE_TAG` 和 `DEPLOYMENT_HOST_IP`，并保留当前所有数据库、Dashboard、processor 和 GeoIP 配置项；模板只放示例值，不放可用凭据。
- 提供不依赖仓库 checkout、Node.js 或 pnpm 的 Compose 命令：先 `docker compose ... pull`，再 `docker compose ... up -d`。`pnpm deploy:*` 可作为仓库开发机快捷入口，但必须调用相同 Compose 配置且不得加 `--build`。
- 迁移、服务依赖、healthcheck、端口绑定、PostgreSQL 数据卷和 GeoIP bind mount 保持现有语义。
- 在部署记录中保存 tag、commit、各镜像 digest、数据库 migration 结果和 healthcheck 结果；失败时把 `TRACELEAF_IMAGE_TAG` 改回上一版已验收的 `vX.Y.Z` 并重新 pull/up。

### 4. 简化 Pi 部署包与文档

- 更新 `docs/deployment-raspberry-pi.md` 记录 Pi 特有的 ARM64、LAN 地址和维护步骤；新增通用 Linux 部署指南，说明 x86-64 Linux 主机使用相同镜像名与 Compose 配置。
- 部署主机只需 64-bit Linux、Docker Engine、Compose 插件、`.env.deploy.example` 模板、`compose.deploy.yaml`、生成后的 `.env.deploy` 和外置 GeoIP 数据；不要求 checkout 源码、Node.js、pnpm 或 Rust toolchain。当前 Compose 将 MMDB 挂载为 `./data/GeoLite2-Country.mmdb`，部署包须提供该相对路径，或在实施时改为必填的宿主机绝对路径变量。
- 私有 GHCR 包使用具备 `read:packages` 权限的 PAT classic 登录（或仓库获授权的 `GITHUB_TOKEN`）；凭据保存在部署主机的 Docker credential store/helper 中，不写入 `.env.deploy`、Compose 文件或镜像。首次推送后确认包与仓库关联及 Actions 读写授权。
- 将 `pnpm deploy:*` 命令定位为仓库开发机快捷入口，增加不依赖 pnpm 的通用 Compose 操作说明，Pi 和 x86-64 主机都可直接执行。
- 说明 PostgreSQL schema migration 的升级顺序、备份要求和镜像回滚边界。升级前按[运维指南](operations.md#postgresql-backup-and-restore)完成并确认备份；应用镜像回滚不会自动回滚已执行的数据库 migration。
- 默认要求 migration 与紧邻的上一平台版本兼容，以支持应用镜像回滚。破坏兼容的 schema 变更使用分阶段 expand/contract 发布；若无法兼容，必须在发布步骤中要求停机并给出从备份恢复的流程，不将“切回旧镜像”描述为完整数据库回滚。

### 部署和升级命令约定

命令通过 `.env.deploy` 中必填且稳定的 `TRACELEAF_COMPOSE_PROJECT_NAME` 隔离本部署；模板为新部署设置为 `traceleaf`。升级既有部署时，必须保留原 Compose 项目名以复用原有容器和数据库卷。`TRACELEAF_IMAGE_NAMESPACE`、`TRACELEAF_IMAGE_TAG`、`DEPLOYMENT_HOST_IP` 和其余必填值也从 `.env.deploy` 读取：

```sh
docker compose --env-file .env.deploy --file compose.deploy.yaml pull
docker compose --env-file .env.deploy --file compose.deploy.yaml up -d
docker compose --env-file .env.deploy --file compose.deploy.yaml ps
```

首次部署需创建 PostgreSQL 数据卷、设置 secrets 并准备外置 GeoIP MMDB。每次升级前按[运维指南](operations.md#postgresql-backup-and-restore)完成并确认数据库备份，再 pull 和 up；Compose 的 `depends_on` 保证 migration 成功后才启动依赖服务。启动后还须检查 `db-migrate` 容器以 exit code 0 完成，以及应用容器状态和日志。不得使用 `down -v` 作为升级或回滚步骤。

`compose.deploy.yaml` 中 `collector` 和 `dashboard` 的宿主机端口仅绑定 `DEPLOYMENT_HOST_IP`。Pi 配置为其稳定 LAN 地址；x86-64 主机应设置为受信任 LAN/私网接口地址，并由主机防火墙限制访问。不得因迁移到 x86-64 而将管理 Dashboard 或数据库公开到不受信任网络。

Smoke check 在每个原生 runner 上使用唯一 Compose project 名（包含 workflow run、attempt 和架构），创建临时 env 文件与独立数据库 volume，挂载 `tests/fixtures/geo/GeoLite2-Country-Test.mmdb` 为 Collector 数据库。检查五个候选镜像都被拉取为当前 runner 原生架构；确认 `db-migrate` exit code 为 0，Collector、Analytics API、Dashboard 的 Docker healthcheck 为 healthy，Processor 保持运行且无启动错误。再以一次性容器执行 db audit purge 命令；无论成功失败都运行该 project 的 `down --volumes --remove-orphans` 清理。临时 env 和 token 仅使用测试值，不复用或上传 `.env.deploy`。

```sh
docker compose --project-name "$SMOKE_PROJECT" --env-file "$SMOKE_ENV_FILE" --file compose.deploy.yaml up -d
docker compose --project-name "$SMOKE_PROJECT" --env-file "$SMOKE_ENV_FILE" --file compose.deploy.yaml run --rm --entrypoint /usr/local/bin/db-migrator db-audit-purger --purge-expired-configuration-audit
docker compose --project-name "$SMOKE_PROJECT" --env-file "$SMOKE_ENV_FILE" --file compose.deploy.yaml down --volumes --remove-orphans
```

`up -d` 通过 Compose 依赖顺序运行空库 migration。仓库脚本 `tooling/deploy/smoke-compose.sh`：从 `compose ps -a -q db-migrate` 获取迁移容器，检查其状态为 exited 且 exit code 为 0，再检查应用服务状态和日志；无论前序任一步成功或失败，都在 trap/finally 清理独立 project 的 volume 与容器。

## 验收标准

- Git `vX.Y.Z` tag 的 `full-validation` 必须通过，才可发布 SHA 候选镜像；GHCR `vX.Y.Z` 版本标签仅在候选镜像的两种架构 smoke check 成功后添加。GitHub Release 在该流程成功后创建。
- 每次候选使用包含 commit、workflow run ID 和 run attempt 的独立 tag；稳定 SHA/版本标签在发布前执行 digest 冲突检查，重跑不得覆盖不同内容。
- 每个应用镜像的 manifest 均包含当前支持的 `linux/amd64` 和 `linux/arm64`，并带有与发布 commit 一致的 OCI 版本和源码信息；未来新增支持平台时，manifest 与验收矩阵同步扩展。
- `ubuntu-24.04` 和 `ubuntu-24.04-arm` 原生 runner 分别拉取并启动所有镜像；确认拉取到的镜像架构与 runner 相符。Collector、Analytics API 和 Dashboard healthcheck 通过，Processor 保持运行且无启动错误，`db-migrate` 在空数据库成功，db audit purge 命令成功。
- 首次预构建镜像发布前，Raspberry Pi 4B 和至少一个 x86-64 Linux 部署主机完成真实 Compose 验收；记录系统架构、镜像 digest、migration 结果和服务健康状态。后续只有在基础镜像、toolchain、架构矩阵、Compose 或部署依赖变化时，才要求重新做对应真实设备验收；常规版本使用原生 runner smoke matrix。
- `db-migrate` 完成后，Collector、Processor 和 Analytics API 按当前 Compose 依赖启动。
- 正常升级流程在 Pi 和 x86-64 部署主机上只拉取镜像并启动，不执行 Cargo、pnpm install、Next.js build 或 Docker build。
- Dashboard 运行镜像不包含完整 workspace `node_modules`；Rust 服务镜像运行层只包含该服务二进制及运行所需文件。
- `.env.deploy`、管理员凭据、数据库凭据和 GeoIP MMDB 不在镜像内。
- 发布流程不会覆盖已存在且对应不同内容的 SHA 或版本标签；失败 job 重跑复用原候选 manifest，重新构建的同一 commit 不会覆盖已晋升标签。
- 能将 `TRACELEAF_IMAGE_TAG` 回退到上一版已验收的版本标签并完成应用镜像回滚；涉及数据库 migration 的版本按照已记录的备份和兼容步骤处理。

## 明确不纳入首批实施

- 将 Rust 服务改为 musl 静态链接或 `scratch` / distroless 镜像。
- 在 Pi 上自动部署 CI 产物或开放远程 Docker API。
- 为 Website 或开发 Playground 构建并发布镜像。
- 修改 Analytics API、数据库 schema 或业务指标语义。
