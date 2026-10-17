# Dashboard

[English](README.md) | [项目概览](../../README.zh-CN.md)

Dashboard 是面向运营人员的 Next.js 应用，用于站点管理和查询 Analytics API 报表。分析数据通过 API 获取，Dashboard 自身不连接 PostgreSQL。

## 开发

要求使用仓库锁定的 Node.js 和 pnpm 版本。在仓库根目录运行：

```bash
pnpm --filter @web-analytics/dashboard dev
```

受支持的本地全栈环境使用 [`pnpm dev:up`](../../docs/getting-started.md)；Compose 会提供服务地址和开发配置。

## 检查与构建

```bash
pnpm --filter @web-analytics/dashboard typecheck
pnpm --filter @web-analytics/dashboard lint
pnpm --filter @web-analytics/dashboard test
pnpm --filter @web-analytics/dashboard build
```

具体脚本定义在 `package.json`。根目录的 `pnpm check`、`pnpm test` 和 `pnpm build` 执行仓库级工作流。

## 配置与边界

本地和部署配置由 Compose 环境提供。不要将部署密钥放入浏览器可见配置。Dashboard 服务端查询 Analytics API；数据库访问和报表处理由后端服务负责。管理站点所需的部署配置见[运维指南](../../docs/operations.md)。

权威设置和发布状态见[Getting Started](../../docs/getting-started.md)、[运维指南](../../docs/operations.md)和[项目状态](../../docs/project-status.md)。
