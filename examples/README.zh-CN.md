# 浏览器与 Router Playground

[English](README.md) | [项目概览](../README.zh-CN.md)

这九个 workspace 在不同环境中验证同一个通用 Browser SDK 和浏览器 Navigation API observer。它们用于开发和导航观察验证，不提供框架专用 Router adapter、正式分析集成或默认启用的后端数据采集。

## 启动 Playground

使用仓库锁定的 Node.js 和 pnpm 版本。首次运行时使用 `pnpm install` 安装依赖，然后在仓库根目录执行对应 workspace 的 `dev` 脚本：

| Playground         | 启动命令                                                                             |
| ------------------ | ------------------------------------------------------------------------------------ |
| Angular            | `pnpm --filter @web-analytics/angular-playground dev`                                |
| Astro              | `pnpm --filter @web-analytics/astro-playground dev`                                  |
| Next.js App Router | `pnpm --filter @web-analytics/nextjs-router-playground dev` 或 `pnpm dev`            |
| React Router       | `pnpm --filter @web-analytics/react-router-playground dev` 或 `pnpm dev:react`       |
| Solid              | `pnpm --filter @web-analytics/solid-playground dev`                                  |
| SvelteKit          | `pnpm --filter @web-analytics/svelte-playground dev`                                 |
| TanStack Router    | `pnpm --filter @web-analytics/tanstack-router-playground dev` 或 `pnpm dev:tanstack` |
| Vanilla browser    | `pnpm --filter @web-analytics/vanilla-playground dev` 或 `pnpm dev:vanilla`          |
| Vue                | `pnpm --filter @web-analytics/vue-playground dev`                                    |

启动后，各框架 dev server 会输出本地访问地址。Docker 封装命令仅支持 Next.js、React Router 和 TanStack Router，详见 [Docker 开发环境](../docker/README.md)。

## 范围与验证

所有 Playground 共用 Navigation API 观察契约。Router 库负责渲染和驱动示例导航；Browser SDK 观察浏览器提交的导航，不连接这些 Router 库。多数示例在本地使用 mock transport。运行 `pnpm e2e:navigation-api` 可验证浏览器导航工作流。SDK 设置和产品边界见 [Browser SDK README](../packages/analytics-browser/README.md)、[Navigation API 决策](../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md)和[项目状态](../docs/project-status.md)。
