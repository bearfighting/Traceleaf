export type Locale = "en" | "zh-cn";

export const locales: Locale[] = ["en", "zh-cn"];

export const translations = {
  en: {
    localeName: "English",
    home: "Home",
    docs: "Docs",
    product: "Product",
    updates: "Updates",
    quickStart: "Quick start",
    demo: "View product demo",
    eyebrow: "Open source web analytics, on your terms",
    headline: "Your analytics.\nYour infrastructure.",
    intro:
      "Traceleaf helps developers understand how their websites are used, while keeping the data and the infrastructure under their control.",
    selfHosted: "Self-hosted by design",
    selfHostedCopy:
      "Run the analytics stack on infrastructure you control. Choose where it lives and how it is operated.",
    privacy: "Privacy in your hands",
    privacyCopy:
      "Collect useful website analytics without building a business around tracking people across the web.",
    workflow: "From navigation to insight",
    workflowCopy:
      "A small browser SDK observes page navigation. Your own services process events and make reports available in the Dashboard.",
    demoLabel: "Illustrative product preview · fixed sample data",
    dashboard: "Overview",
    last7Days: "Last 7 days",
    pageViews: "Page views",
    visitors: "Visitors",
    avgDuration: "Avg. visit duration",
    topPages: "Top pages",
    page: "Page",
    views: "Views",
    navTitle: "Explore Traceleaf",
    navCopy: "Product details, setup steps, and project updates.",
    productTitle: "Understand your website without handing over your analytics",
    productIntro:
      "Traceleaf is a self-hosted web analytics platform built for developers who want useful product insight and control over where their data lives.",
    featuresTitle: "What Traceleaf does today",
    featurePageViews: "Page views and journeys",
    featurePageViewsCopy:
      "See pages visited, navigation trends, top content, and anonymous visitor and session activity.",
    featureEvents: "Events and performance",
    featureEventsCopy:
      "Collect custom events and Web Vitals alongside browser and campaign context.",
    featureControl: "Operate your own stack",
    featureControlCopy:
      "Run the Collector, PostgreSQL storage, processor, API, and Dashboard in infrastructure you manage.",
    quickTitle: "Quick start",
    quickIntro:
      "Start locally, explore the Dashboard, and follow the verified setup instructions in the repository guide.",
    requirementsTitle: "Requirements",
    requirementsCopy:
      "Node.js 26.10.0, pnpm 12.6.0, and Docker Compose v2 for the full local stack.",
    localDashboard: "Dashboard: http://localhost:13000/dashboard",
    localPlayground: "Next.js playground: http://localhost:3000",
    quickNote:
      "These commands start the repository's local development stack. The Browser SDK release is not yet available for external installation; use the repository guide for complete setup details.",
    openGuide: "Open repository guide",
    updatesTitle: "Project updates",
    updatesIntro: "Why Traceleaf exists, what it does today, and where we hope to take it.",
    articleTitle: "Analytics should belong to the people who run the site",
    articleDate: "October 2026",
    articleSummary:
      "Traceleaf began with a simple frustration: website analytics should not require giving up control of your data or infrastructure.",
    articleMotivation: "Why we started Traceleaf",
    articleMotivationCopy:
      "Many developers want to understand whether their websites are useful, where visitors go, and whether pages perform well. Hosted analytics can make that easy, but it also puts a third party between the site owner and the data. We started Traceleaf to make a self-hosted alternative practical: a developer can run the services, inspect the workflow, and decide how the system fits their own site.",
    articleFeatures: "What it does today",
    articleFeaturesCopy:
      "Traceleaf provides a framework-independent browser SDK and navigation observer, an event collector, PostgreSQL-backed processing and query services, and a Dashboard. The current product covers page views, anonymous visitors and sessions, browser context, custom events, Web Vitals, conversion and funnel reports, country-level geography, and site configuration. These are product capabilities in the current repository; availability and release status should be checked in the project documentation.",
    articleVision: "Where we want to go",
    articleVisionCopy:
      "We want Traceleaf to become a dependable, understandable analytics tool that developers can operate on infrastructure they choose. That means clear data flows, modest operational requirements, useful reporting, and privacy-conscious defaults. This is a direction, not a promise that every capability is complete or production-ready. We will publish concrete changes as they are implemented and verified.",
    articleClose:
      "Traceleaf is built in the open. The project welcomes developers who value control, transparency, and tools that can be run on their own terms.",
    footerLine: "Web analytics for developers who want to stay in control.",
    sample: "Sample data",
  },
  "zh-cn": {
    localeName: "简体中文",
    home: "首页",
    docs: "文档",
    product: "产品",
    updates: "动态",
    quickStart: "快速开始",
    demo: "查看产品演示",
    eyebrow: "开源网站分析，由你掌控",
    headline: "你的分析数据，\n运行在你的基础设施上。",
    intro: "Traceleaf 帮助开发者了解网站的使用情况，同时让数据和运行环境留在自己的掌控之中。",
    selfHosted: "为自托管而设计",
    selfHostedCopy: "在你控制的基础设施上运行分析服务，自行选择部署位置和运维方式。",
    privacy: "把隐私选择权交还给你",
    privacyCopy: "获取有用的网站分析数据，不把跨站追踪用户作为产品的商业基础。",
    workflow: "从页面导航到分析结果",
    workflowCopy:
      "轻量的浏览器 SDK 观察页面导航。你自己的服务处理事件，并通过 Dashboard 提供报表。",
    demoLabel: "产品效果示意 · 固定示例数据",
    dashboard: "概览",
    last7Days: "最近 7 天",
    pageViews: "页面浏览量",
    visitors: "访客数",
    avgDuration: "平均访问时长",
    topPages: "热门页面",
    page: "页面",
    views: "浏览量",
    navTitle: "探索 Traceleaf",
    navCopy: "了解产品、开始配置并查看项目动态。",
    productTitle: "无需交出分析数据，也能了解网站表现",
    productIntro:
      "Traceleaf 是一款面向开发者的自托管网站分析平台，让你获得有用的产品洞察，并掌控数据的存储位置。",
    featuresTitle: "Traceleaf 当前提供的能力",
    featurePageViews: "页面浏览与访问路径",
    featurePageViewsCopy: "查看浏览页面、导航趋势、热门内容，以及匿名访客和会话活动。",
    featureEvents: "事件与性能",
    featureEventsCopy: "在浏览器和营销上下文之外，也可收集自定义事件与 Web Vitals。",
    featureControl: "运行自己的分析服务",
    featureControlCopy:
      "在你管理的基础设施上运行 Collector、PostgreSQL、Processor、API 和 Dashboard。",
    quickTitle: "快速开始",
    quickIntro: "在本地启动项目、了解 Dashboard，并按照仓库中的已验证指南完成配置。",
    requirementsTitle: "环境要求",
    requirementsCopy: "运行完整本地环境需要 Node.js 26.10.0、pnpm 12.6.0 和 Docker Compose v2。",
    localDashboard: "Dashboard 地址：http://localhost:13000/dashboard",
    localPlayground: "Next.js Playground 地址：http://localhost:3000",
    quickNote:
      "这些命令会启动仓库的本地开发环境。Browser SDK 尚未发布为可供外部安装的版本；完整步骤请查看仓库指南。",
    openGuide: "打开仓库指南",
    updatesTitle: "项目动态",
    updatesIntro: "了解 Traceleaf 为什么开始、现在能做什么，以及未来希望走向哪里。",
    articleTitle: "网站分析应该属于运营网站的人",
    articleDate: "2026 年 10 月",
    articleSummary:
      "Traceleaf 起源于一个简单的想法：网站分析不应该以交出数据和基础设施控制权为代价。",
    articleMotivation: "为什么开始做 Traceleaf",
    articleMotivationCopy:
      "很多开发者想知道自己的网站是否有用、访客去了哪里，以及页面性能如何。托管分析服务让这些问题更容易回答，但也让第三方介入了网站所有者与数据之间。我们开始做 Traceleaf，是希望让自托管成为一种可行的选择：开发者可以运行这些服务、检查数据流程，并决定系统如何适配自己的网站。",
    articleFeatures: "当前已经实现的功能",
    articleFeaturesCopy:
      "Traceleaf 提供框架无关的浏览器 SDK 和导航观察器、事件 Collector、基于 PostgreSQL 的处理与查询服务，以及 Dashboard。当前代码库覆盖页面浏览、匿名访客与会话、浏览器上下文、自定义事件、Web Vitals、转化与漏斗报表、国家级地理信息和站点配置。具体能力的可用性和发布状态，请以项目文档为准。",
    articleVision: "我们希望走向哪里",
    articleVisionCopy:
      "我们希望 Traceleaf 成为一款可靠、易理解的分析工具，让开发者可以在自己选择的基础设施上运行。为此，数据流应该清晰，运维要求适度，报表实用，并默认尊重隐私。这是发展方向，不代表所有能力都已完成或达到生产就绪状态。我们会在功能完成并经过验证后发布具体进展。",
    articleClose:
      "Traceleaf 以开放方式开发。我们欢迎重视控制权、透明度，以及能够按自己方式运行工具的开发者参与。",
    footerLine: "为希望掌控数据的开发者打造的网站分析工具。",
    sample: "示例数据",
  },
} as const;

export type Copy = (typeof translations)[Locale];
