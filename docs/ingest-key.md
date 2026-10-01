# Ingest Key Guide

## 1. 目的和边界

`X-Ingest-Key` 是 Browser SDK 发送事件时携带的公开接入标识。它用于将请求绑定到指定的 `site_id + environment`，并降低简单误用风险。

Ingest Key 会被发送到浏览器，因此不是 secret，也不能作为唯一的安全边界。Collector 仍然必须执行 Origin allowlist 和基础 rate limiting。

设计原则：

- Backend 负责生成和验证 key。
- Website 负责公开使用 key。
- Origin allowlist 负责 Website 与 site 的关联。
- Key 不从 URL、`site_id`、时间戳或其他公开字段推导。
- Phase 2 不提供在线 key 管理 API。

## 2. 配置模型

Collector 从 PostgreSQL 的 Site Management policy 中读取每个 `site_id + environment` 的配置。以下 TOML 只展示旧版本的迁移格式，不作为当前运行时配置：

```toml
[[sites]]
site_id = "site_example"
environment = "production"
enabled = true
allowed_origins = ["https://www.example.com"]
ingest_keys = ["generated-public-key"]
```

`ingest_keys` 使用数组，以便轮换时短暂允许旧 key 和新 key 同时有效。
生产配置至少包含一个 key；Collector 不支持无 key 的生产降级模式。

旧版 Phase 2 TOML 样例保留在 [`collector.example.toml`](../protocol/contracts/http-ingestion/current/config/collector.example.toml)，用于迁移和协议测试；Collector 启动不再接受 TOML 配置路径。

Origin 是完整的 `scheme + host + port`：

```text
https://www.example.com
http://localhost:3000
```

页面 path 不属于 Origin。因此 `https://www.example.com/about` 不应单独配置；它与 `https://www.example.com` 属于同一个 Origin。

以下值是不同 Origin：

```text
http://localhost:3000
https://localhost:3000
http://localhost:4000
https://www.example.com
https://app.example.com
```

## 3. 生成 key

Key 必须由 Backend CLI 或部署工具使用密码学安全随机数生成。建议生成 32 字节并编码为 Base64URL：

```ts
import { randomBytes } from "node:crypto";

const ingestKey = randomBytes(32).toString("base64url");
console.log(ingestKey);
```

Collector CLI 只生成并输出 key，不会自动修改 TOML：

```bash
collector key generate \
  --site site_example \
  --environment production
```

stdout 只包含一行无 padding 的 Base64URL key。`site` 和 `environment` 用于明确生成上下文，不参与 key 推导；生成命令不会写入配置文件。部署者需要将输出手动加入对应 TOML 的 `ingest_keys`，再将同一个公开值配置给 Website：

```bash
INGEST_KEY="$(collector key generate --site site_example --environment production)"
printf '%s\n' "$INGEST_KEY"
```

Collector 使用操作系统安全随机源生成 32 字节 key。生成上下文可以出现在 stderr 日志中，但完整 key 不会进入日志。请求日志只记录 `key_sha256` 的前 12 个 hex 字符。

不要使用以下方式生成 key：

- `hash(site_id + url)`
- site ID 拼接字符串
- 时间戳或递增数字
- 人工编写的短字符串
- 在浏览器端动态生成

生成结果应写入 Collector 配置，并通过部署配置传给 Website。日志不得打印完整 key。

## 4. Website 使用 key

Website 通过公开环境变量或等价的构建配置使用 key：

```env
NEXT_PUBLIC_ANALYTICS_SITE_ID=site_example
NEXT_PUBLIC_ANALYTICS_INGEST_KEY=generated-public-key
NEXT_PUBLIC_ANALYTICS_ENDPOINT=https://analytics.example.com/v1/events
```

FetchTransport 将其发送为：

```http
X-Ingest-Key: generated-public-key
```

因为该值会进入浏览器 bundle，不能把它当作数据库密码、管理员 token 或其他 secret 使用。

## 5. Collector 校验流程

EventBatch V1 不携带 `environment` 字段。Collector 不能从请求 body 读取或信任 environment；environment 由匹配到的服务端 site 配置确定。

PR5 已实现的请求处理逻辑遵循以下顺序：

```text
读取 batch.site_id
  → 查找对应的 site 配置
  → 检查 site 是否 enabled
  → 检查 Origin 是否匹配该 site/environment
  → 检查 X-Ingest-Key 是否匹配某个 site/environment 配置
  → 确定唯一的 site/environment
  → 检查 site_id + Origin 限流
  → 校验 EventBatch V1
  → 写入 EventSink
```

Origin、key 和 rate limit 必须共同匹配同一个 enabled environment。同一 site 的不同 environment 不能配置相同 Origin；Origin 与 key 的交集必须唯一。缺失或不允许的 Origin 返回 `403 origin_not_allowed`；Origin 允许但 key 缺失或错误返回 `401 invalid_ingest_key`。每个 `site_id + Origin` 默认每分钟允许 600 个请求，超限返回 `429` 和 `Retry-After: 60`。

Key 不能绕过 Origin allowlist。缺失或错误的 key 返回 `401 invalid_ingest_key`；不允许的 Origin 返回 `403 origin_not_allowed`。

合法请求的 body 最大为 64 KiB，batch 最大为 100 个事件；请求必须使用 `application/json`（可带 charset 参数），否则返回 `415 unsupported_media_type`。

Preflight 请求不携带实际的 `X-Ingest-Key` 值，因此 OPTIONS 只执行 Origin、method、request headers 和 CORS 相关检查；真正的 POST 必须执行完整 Origin/key 校验和限流。

## 6. 本地开发

本地开发需要显式配置 localhost Origin：

```toml
allowed_origins = ["http://localhost:3000"]
```

Website 和 Collector 必须使用同一组 `site_id`、environment 对应的 key。不要为了方便将 Origin allowlist 放宽为 `*`。

## 7. 手动轮换

Phase 2 不提供自动轮换和在线管理 API，但配置支持多个有效 key，允许部署者执行手动轮换。推荐流程：

```text
生成新 key
  → 将新旧 key 同时加入 Collector 配置
  → 发布使用新 key 的 Website 版本
  → 等待旧 Website bundle 过期
  → 从 Collector 配置删除旧 key
```

如果 key 泄露，应立即从 Collector 配置删除，并重新生成和部署新 key。由于 key 是公开值，轮换不能替代 Origin allowlist 和 rate limiting。

## 8. 排查清单

- 检查 Website 使用的 endpoint 是否包含 `/v1/events`。
- 检查 `site_id` 是否与 Collector 配置完全一致。
- 检查 Origin 的 scheme、host 和 port 是否完全匹配。
- 检查 Collector 是否启用了对应 site/environment。
- 检查 Website bundle 是否仍在使用旧 key。
- 检查 Collector 日志中的脱敏 key 标识，不要打印或复制完整 key。
