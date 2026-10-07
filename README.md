# Web Analytics Platform

为网站提供浏览器端浏览、事件和基础性能统计，并通过 Dashboard 查看和管理。

## 当前状态

MVP 功能已冻结，暂不增加新功能。唯一的未完成与部署待办清单见[功能冻结与部署待办](docs/project-status.md)。功能范围见 [MVP Scope](docs/mvp-scope.md)。

## 核心 Workflow

```mermaid
flowchart LR
    subgraph Browser[网站与浏览器]
        Website[Next.js 网站]
        Observer[Router Adapter<br/>观察页面加载与客户端导航]
        SDK[Browser SDK<br/>采集上下文并组装事件]
        Protocol[Event Protocol]
        Website --> Observer --> SDK --> Protocol
    end

    subgraph Ingestion[事件接收]
        Collector[Collector<br/>校验 Origin、站点策略和事件]
    end

    subgraph Storage[PostgreSQL]
        Raw[(原始事件与接收元数据)]
        Facts[(派生事实、汇总与处理进度)]
        Config[(站点配置、定义与审计)]
    end

    subgraph Processing[事件处理]
        Processor[Processor<br/>轮询处理、归一化与统计]
        Rebuild[显式重建命令<br/>Generation / Facts]
    end

    subgraph Serving[查询与展示]
        API[Analytics API<br/>报表查询与站点管理]
        Dashboard[Dashboard<br/>报表与配置管理]
    end

    Protocol -->|HTTP / Beacon| Collector
    Collector -->|写入| Raw
    Collector -->|读取站点接收策略| Config
    Raw -->|读取原始事件| Processor
    Processor -->|更新处理状态| Raw
    Config -->|读取 capabilities 与 definitions| Processor
    Processor -->|写入| Facts
    Raw -->|重建时读取原始事件| Rebuild
    Config -->|重建时读取站点配置| Rebuild
    Rebuild -->|重建| Facts
    API -->|读取分析结果| Facts
    Dashboard -->|报表请求| API
    Dashboard -->|配置管理请求| API
    API -->|读写站点配置与审计| Config
```

常规数据流从网站导航开始：Router Adapter 观察导航，Browser SDK 根据 Event Protocol 发送事件；Collector 校验并写入原始事件；Processor 轮询原始事件并生成分析结果；Dashboard 通过 Analytics API 查询结果。站点配置和定义由管理 API 写入，Collector 读取接收策略，Processor 按配置处理事件。显式 rebuild 命令用于重建整站 generation 或指定派生事实。

当前 MVP 包含页面浏览、访客与会话分析、Browser Context、Custom Events、Web Vitals、Conversion/Funnel、country Geo，以及站点 capability 和 ingest policy 配置。完整范围见 [MVP Scope](docs/mvp-scope.md)。

## 开始使用

开发环境和本地运行步骤见 [Getting Started](docs/getting-started.md)。

## 文档入口

- [Documentation Index](docs/README.md)
- [Feature Freeze and Deployment Follow-up](docs/project-status.md)
- [MVP Scope](docs/mvp-scope.md)
- [Getting Started](docs/getting-started.md)
- [Event Protocol](docs/event-protocol.md)

## 开发与验证

项目协作规则见 [AGENTS.md](AGENTS.md)。CI 运行统一的检查、测试、构建、migration、integration 和 E2E workflow。
