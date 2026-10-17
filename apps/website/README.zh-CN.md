# Traceleaf 网站

[English](README.md) | 简体中文

公开网站是独立的 Next.js 应用，构建为静态 HTML、CSS 和 JavaScript。运行时不依赖 Dashboard 或后端服务。

## 开发

在仓库根目录运行：

```bash
pnpm dev:website
```

英文页面位于 `/`，简体中文页面位于 `/zh-cn/`。

## 静态构建

```bash
pnpm --filter @traceleaf/website build
```

Next.js 将可部署文件写入 `apps/website/out/`。构建后可使用任意静态文件主机，无需运行 Next.js 服务。

## 内容与样式

- 双语界面和初始 Updates 文案位于 `lib/content.ts`。
- 页面布局和网站导航位于 `components/`。
- 语义化浅色/深色主题 token 和响应式基础样式位于 `app/globals.css`。
- 产品预览使用固定示例数据，不请求分析服务。
- Motion for React 用于产品预览的少量分阶段动画；图表动画和减少动态效果回退由 CSS 实现。

相关指南：[项目概览](../../README.zh-CN.md)、[Getting Started](../../docs/getting-started.md)、[项目状态](../../docs/project-status.md)。
