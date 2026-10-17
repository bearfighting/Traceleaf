# Site Registry Importer

[English](README.md) | [项目概览](../../README.zh-CN.md)

此 CLI 将 Site ID 与明确选定的 PostgreSQL 数据库及明确提供的旧数据源对账。默认只读，不读取 `.env` 或 Compose 文件。

## 输入与报告

`DATABASE_URL` 必须指向预期目标。每个静态来源都必须显式提供值/路径，或提供对应 `--*-not-configured` 状态标志：

- `--dashboard-sites` 和 `--dashboard-default-site`
- `--collector-config PATH`
- `--definitions-file PATH`
- `--dev-seed-site-id` 和 `--dev-seed-origins`

未配置来源的标志示例包括 `--collector-not-configured` 和 `--definitions-not-configured`。已配置但无法读取或内容无效的来源会报错。Collector TOML 只提供 Site ID、环境名和 Allowed Origins，作为本地对照线索；反序列化时会丢弃 `ingest_keys` 值，绝不会写入报告。策略覆盖统计仅读取 digest 数量，不读取 digest 值。

每次运行都必须设置 `--report /absolute/path/outside/the/repository/report.json`。目标必须是尚不存在的新文件。Importer 使用独占创建，拒绝链接和已存在文件，apply 时更新同一已打开文件。报告包含各来源行数/不同 ID 计数、候选 ID 和来源重叠、策略/环境覆盖及启用和非机密计数、本地 Origin 对照证据与冲突、已存在 Registry 元数据、缺失名称/URL 状态和待审核 ID。报告是本地证据，不得提交到版本库。stdout 摘要只包含计数。

## 审核与应用

首先不带 `--apply` 运行。具有测试/fixture 风格 ID、元数据冲突或无数据库身份来源的候选项会标记为 `requires_disposition`。为每个此类 ID 创建本地 JSON 决策文件：

```json
[
  {
    "site_id": "sample_fixture_site",
    "action": "approve",
    "reason": "confirmed retained Site identity"
  },
  {
    "site_id": "stale_static_site",
    "action": "exclude",
    "reason": "confirmed obsolete static entry"
  }
]
```

已持久化的数据库身份不能排除，必须批准为 Site。静态来源独有的候选项可在审核后排除。缺失元数据允许保留为 null；Allowed Origins 仅是本地对照线索，绝不会作为 Website URL。未解决的 Origin 或元数据冲突会阻止 apply。当前静态来源不提供权威 Site 名称或规范 URL，因此 importer 只写入身份，不覆盖 Registry 中已有元数据。

每次 apply 都必须显式执行且具幂等性：

```sh
: "${DATABASE_URL:?通过批准的 secret 注入机制提供已审核目标}"
cargo run -p site-registry-importer -- \
  --report /tmp/site-registry-import.json \
  --dashboard-sites 'site_alpha,site_beta' --dashboard-default-site site_alpha \
  --collector-config ./collector.toml --definitions-file ./definitions.json \
  --dev-seed-site-id site_alpha --dev-seed-origins https://site.example \
  --dispositions-file /tmp/site-dispositions.json --apply
```

缺失的输入必须用对应 `--*-not-configured` 状态标志替换其值或路径；dev-seed Site ID 和 origins 有独立状态标志。Apply 使用事务级 advisory lock，只插入缺失的 Registry ID，不导入策略或密钥、不修改来源表，也不添加外键。

## 安全要求

- 每次 apply 前都要对目标执行 dry-run。此 M3.3 实现验证只允许对可丢弃的 PostgreSQL 数据库执行 apply。
- 不要将 ingest key 作为 CLI 参数传入。决策理由中不得包含密钥。
- 详细报告路径若解析到仓库目录内会被拒绝。报告必须是新文件；已有文件、符号链接和硬链接均不会被覆盖。
- Importer 要求已存在 M3.2 的 `site_registry` schema 和所有已盘点来源表；它不会运行数据库迁移。

## 目标数据库导入操作手册

M3.4 兼容性检查只使用可丢弃 PostgreSQL 数据库。以下步骤描述后续经明确批准的目标导入流程；这不构成 M3.4 期间对共享或部署数据库执行操作的授权。

1. **准备目标并备份。** 通过批准的 secret 注入机制获取 `DATABASE_URL`；不要将含凭据的 URL 放入 shell history、命令输出或仓库。为 `pg_dump`/`psql` 在仓库外配置不含密码的 libpq service 和受保护 passfile。确认 service 指向唯一预期目标，然后创建并验证 custom-format 备份：

   ```sh
   : "${PGSERVICE:?set the reviewed target service name}"
   psql "service=$PGSERVICE" -XAtc "SELECT current_database() || ' @ ' || inet_server_addr() || ':' || inet_server_port()"
   pg_dump --dbname="service=$PGSERVICE" --format=custom --no-owner --no-privileges --file="$BACKUP_FILE"
   pg_restore --list "$BACKUP_FILE" >/dev/null
   ```

   Importer 的 `DATABASE_URL` 与用于备份的 libpq service 必须解析到同一数据库和服务器。通过批准的 secret 注入路径核实两者身份；不要打印任何含凭据的连接串。记录数据库身份、备份路径和时间。Importer 不运行迁移；在运行前先备份并验证 M3.2。

### 迁移前预检：只读 SQL 基线（备份后）

验证备份后、应用迁移前，为基线输出设置一个仓库外的新路径，并使用针对该目标审核过的 libpq service。不要将含凭据的数据库 URL 放入命令参数或输出：

```sh
: "${PGSERVICE:?set the reviewed local target service name}"
: "${BASELINE_REPORT:?set a new absolute report path outside the repository}"
set -C
umask 077
psql "service=$PGSERVICE" -X -v ON_ERROR_STOP=1 > "$BASELINE_REPORT" <<'SQL'
BEGIN READ ONLY;
SELECT current_database() AS database_name,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       current_setting('listen_addresses') AS listen_addresses,
       current_setting('port') AS configured_port;
SELECT max(version) AS latest_successful_migration
FROM _sqlx_migrations WHERE success;
SELECT to_regclass('public.site_registry') AS site_registry_relation;
SELECT c.table_name AS site_id_table
FROM information_schema.columns AS c
WHERE c.table_schema = 'public' AND c.column_name = 'site_id'
  AND EXISTS (
      SELECT 1 FROM information_schema.tables AS t
      WHERE t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
  )
GROUP BY c.table_name ORDER BY c.table_name;
SELECT format(
  'SELECT %L AS source, count(*)::bigint AS rows, count(DISTINCT site_id)::bigint AS distinct_site_ids FROM %I.%I',
  c.table_name, c.table_schema, c.table_name
)
FROM information_schema.columns AS c
WHERE c.table_schema = 'public' AND c.column_name = 'site_id'
  AND EXISTS (
      SELECT 1 FROM information_schema.tables AS t
      WHERE t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
  )
GROUP BY c.table_schema, c.table_name
ORDER BY c.table_name
\gexec
SELECT 'configuration_audit' AS source, count(*)::bigint AS audit_rows,
       count(DISTINCT resource->>'site_id')::bigint AS distinct_site_ids
FROM configuration_audit WHERE resource ? 'site_id';
SELECT environment, count(*)::bigint AS policies,
       sum(jsonb_array_length(document->'allowed_origins'))::bigint AS allowed_origin_count,
       sum(jsonb_array_length(document->'ingest_keys'))::bigint AS key_digest_count
FROM site_environment_policies GROUP BY environment ORDER BY environment;
ROLLBACK;
SQL
```

目录查询会枚举所有包含直接 `site_id` 列的 public 表；需与 M3 source matrix 对照。两个 runtime-state 表作为排除证据，四个 processing 表仅用于交叉核验。该基线只输出计数，不输出每个 Site 的明细。若使用 Unix socket 导致 `inet_server_addr()` 为 null，应通过审核过的 Compose 容器身份和发布端口核实服务端点。若数据库身份、表清单、迁移历史或报告不完整，应停止操作。

2. **运行并审核只读预检。** 使用仓库外的新报告路径。每个静态来源都要按目标实际输入明确提供，或标记为 `not_configured`。审核候选并集、来源行数/不同 ID 计数、重叠、来源独有 ID、Registry 元数据、策略覆盖、Origins 和 processing 交叉核验。解决所有 Origin/元数据冲突，并为每个待决策 ID 提供有依据的 approve/exclude 决定。definitions 文件独有 ID 是静态候选；按当前 schema，已存储 definition revision 必须有 capability row。

3. **审核后才应用。** 精确复用预检输入参数和已审核的决策文件，使用第二个新报告路径并显式加 `--apply`。记录 CLI 退出状态和新增 Registry 行数。不要手动插入 Registry 行或策略/密钥数据。

4. **运行后检并核对。** 使用相同输入、不带 `--apply`，写入第三个新报告。候选并集须与预检一致；`db.site_registry_existing.distinct_site_ids` 应等于预检数量加成功插入数。确认获批候选均存在、排除的静态独有 ID 仍被排除、已有 Registry 元数据未变。比较预检与后检的持久身份表行数、审计行、策略环境/Origin 证据、密钥 digest 数量和 processing 交叉核验；Importer 不得改变这些内容。三份详细报告均须留在版本控制之外。

5. **失败恢复。** Importer 的写入在单个事务中执行。插入失败时确认进程以非零状态退出，保留失败报告和错误；修正原因后用新报告路径重跑预检，再用新路径重试 apply。重复 apply 具幂等性，已提交身份会产生零新增行。不得自动删除 Registry 或历史行作为回滚。若发生更大范围的目标损坏，只能在先审核恢复范围及后续写入后，按照数据库恢复流程还原已验证备份。

每次 apply 后，预期 Registry 基数为“预检 Registry 行数 + 成功插入数”；来源表行数、策略文档、密钥 digest、审计证据和历史记录都应保持不变。任何不匹配都应暂停 rollout 并调查。M4 会另行验证缺少、禁用和归档策略时的 fail-closed 行为。
