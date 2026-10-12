import Link from "next/link";

import { ProductPreview } from "@/components/product-preview";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Copy, Locale } from "@/lib/content";

function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="text-balance mt-5 text-4xl font-semibold leading-tight tracking-display sm:text-5xl">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">{description}</p>
    </div>
  );
}

export function ProductPage({ locale, copy }: { locale: Locale; copy: Copy }) {
  return (
    <main className="page-width section-space" id="main-content">
      <PageTitle description={copy.productIntro} eyebrow={copy.product} title={copy.productTitle} />
      <div className="mt-12">
        <ProductPreview copy={copy} />
      </div>
      <section className="mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.featuresTitle}</h2>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {[copy.featurePageViews, copy.featureEvents, copy.featureControl].map((title, index) => {
            const body = [
              copy.featurePageViewsCopy,
              copy.featureEventsCopy,
              copy.featureControlCopy,
            ][index];
            return (
              <Card className="p-6" key={title}>
                <span className="text-xs font-semibold tracking-widest text-primary">
                  0{index + 1}
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
              </Card>
            );
          })}
        </div>
      </section>
      <div className="mt-12">
        <ButtonLink href={locale === "en" ? "/docs/quick-start" : "/zh-cn/docs/quick-start"}>
          {copy.quickStart}
          <span aria-hidden="true">↗</span>
        </ButtonLink>
      </div>
    </main>
  );
}

export function QuickStartPage({ locale, copy }: { locale: Locale; copy: Copy }) {
  return (
    <main className="page-width section-space" id="main-content">
      <PageTitle description={copy.quickIntro} eyebrow={copy.docs} title={copy.quickTitle} />
      <div className="quick-start-grid mt-10 grid gap-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold">
            {locale === "en" ? "Run the local development stack" : "运行本地开发环境"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {locale === "en"
              ? "The repository guide explains prerequisites, dependency installation, the Router Playground, and the full Docker Compose environment."
              : "仓库指南介绍环境要求、依赖安装、Router Playground 和完整的 Docker Compose 开发环境。"}
          </p>
          <div className="mt-5 rounded-lg border border-border bg-surface-subtle p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {copy.requirementsTitle}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.requirementsCopy}</p>
          </div>
          <pre className="mt-6 overflow-x-auto rounded-xl bg-foreground p-5 font-mono text-sm leading-7 text-background">
            <code>
              cp .env.example .env{"\n"}pnpm install{"\n"}pnpm dev:up
            </code>
          </pre>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">{copy.quickNote}</p>
          <div className="mt-5 space-y-2 text-sm text-muted-foreground">
            <p>{copy.localDashboard}</p>
            <p>{copy.localPlayground}</p>
          </div>
          <a
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            href="https://github.com/bearfighting/Traceleaf/blob/main/docs/getting-started.md"
          >
            {copy.openGuide}
            <span aria-hidden="true">↗</span>
          </a>
        </Card>
        <Card className="bg-surface-subtle p-6 sm:p-8">
          <h2 className="text-lg font-semibold">
            {locale === "en" ? "What you will find" : "你将看到什么"}
          </h2>
          <ol className="mt-5 space-y-5">
            {[
              locale === "en"
                ? "Install the pinned workspace dependencies."
                : "安装项目锁定版本的工作区依赖。",
              locale === "en"
                ? "Run the Next.js Router Playground or the full local stack."
                : "运行 Next.js Router Playground 或完整本地服务。",
              locale === "en"
                ? "Explore site onboarding and reports in the Dashboard."
                : "在 Dashboard 中体验站点接入和分析报表。",
            ].map((step, index) => (
              <li className="flex gap-4 text-sm leading-6 text-muted-foreground" key={step}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </main>
  );
}

export function UpdatesPage({ locale, copy }: { locale: Locale; copy: Copy }) {
  const prefix = locale === "en" ? "" : "/zh-cn";
  return (
    <main className="page-width section-space" id="main-content">
      <PageTitle description={copy.updatesIntro} eyebrow={copy.updates} title={copy.updatesTitle} />
      <div className="mt-10 max-w-3xl">
        <Link className="group block" href={`${prefix}/updates/why-traceleaf`}>
          <Card className="update-card-grid grid gap-6 p-6 transition-shadow group-hover:shadow-md sm:p-8">
            <div
              className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-2xl text-primary"
              aria-hidden="true"
            >
              ✳
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {copy.articleDate} · {locale === "en" ? "Project story" : "项目介绍"}
              </p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight group-hover:text-primary sm:text-2xl">
                {copy.articleTitle}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.articleSummary}</p>
            </div>
          </Card>
        </Link>
      </div>
    </main>
  );
}

export function UpdateArticle({ copy }: { locale: Locale; copy: Copy }) {
  return (
    <main className="narrow-width section-space" id="main-content">
      <article>
        <header className="border-b border-border pb-8">
          <Link
            className="text-sm font-medium text-primary hover:underline"
            href={copy.localeName === "English" ? "/updates" : "/zh-cn/updates"}
          >
            ← {copy.updates}
          </Link>
          <p className="eyebrow mt-8">
            {copy.updates} · {copy.articleDate}
          </p>
          <h1 className="text-balance mt-5 text-4xl font-semibold leading-tight tracking-display sm:text-5xl">
            {copy.articleTitle}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">{copy.articleSummary}</p>
        </header>
        <div className="article-body mt-9 space-y-10">
          <section>
            <h2>{copy.articleMotivation}</h2>
            <p>{copy.articleMotivationCopy}</p>
          </section>
          <section>
            <h2>{copy.articleFeatures}</h2>
            <p>{copy.articleFeaturesCopy}</p>
          </section>
          <section>
            <h2>{copy.articleVision}</h2>
            <p>{copy.articleVisionCopy}</p>
          </section>
          <Card className="bg-surface-subtle p-6 text-sm leading-7 text-muted-foreground">
            {copy.articleClose}
          </Card>
        </div>
      </article>
    </main>
  );
}
