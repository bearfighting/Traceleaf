import Link from "next/link";

import { ProductPreview } from "@/components/product-preview";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Copy, Locale } from "@/lib/content";

export function HomeContent({ locale, copy }: { locale: Locale; copy: Copy }) {
  const prefix = locale === "en" ? "" : "/zh-cn";

  return (
    <main id="main-content">
      <section className="relative overflow-hidden pb-20 pt-16 sm:pb-28 sm:pt-24 lg:pt-28">
        <div aria-hidden="true" className="hero-wash" />
        <div className="page-width home-hero-grid relative grid items-center gap-14 lg:gap-8">
          <div className="max-w-xl">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 className="text-balance mt-6 whitespace-pre-line text-5xl font-semibold leading-display tracking-display sm:text-6xl lg:text-7xl">
              {copy.headline}
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">{copy.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={`${prefix}/docs/quick-start`} size="large">
                {copy.quickStart}
                <span aria-hidden="true">↗</span>
              </ButtonLink>
              <ButtonLink href={`${prefix}/product`} size="large" variant="secondary">
                {copy.demo}
              </ButtonLink>
            </div>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              {locale === "en"
                ? "Open source · self-hosted · framework-independent browser SDK"
                : "开源 · 自托管 · 框架无关的浏览器 SDK"}
            </p>
          </div>
          <ProductPreview copy={copy} />
        </div>
      </section>

      <section className="border-y border-border bg-surface-subtle py-5">
        <div className="page-width flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-muted-foreground sm:justify-between">
          <span>{locale === "en" ? "Keep the data path visible" : "让数据流清晰可见"}</span>
          <span aria-hidden="true" className="hidden text-border sm:inline">
            ✳
          </span>
          <span>{locale === "en" ? "Run it where you choose" : "在自己选择的环境运行"}</span>
          <span aria-hidden="true" className="hidden text-border sm:inline">
            ✳
          </span>
          <span>{locale === "en" ? "Built for the open web" : "为开放网络而构建"}</span>
        </div>
      </section>

      <section className="page-width section-space">
        <div className="max-w-2xl">
          <p className="eyebrow">
            {locale === "en" ? "The Traceleaf approach" : "Traceleaf 的方式"}
          </p>
          <h2 className="text-balance mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            {locale === "en"
              ? "Useful insight, without giving up control."
              : "获得有用洞察，也保留掌控权。"}
          </h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { number: "01", title: copy.selfHosted, description: copy.selfHostedCopy, icon: "⌂" },
            { number: "02", title: copy.privacy, description: copy.privacyCopy, icon: "◉" },
            { number: "03", title: copy.workflow, description: copy.workflowCopy, icon: "↗" },
          ].map((item) => (
            <Card className="p-6 sm:p-7" key={item.number}>
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-xl text-primary">
                  {item.icon}
                </span>
                <span className="text-xs font-semibold tracking-widest text-muted-foreground/70">
                  {item.number}
                </span>
              </div>
              <h3 className="mt-7 text-lg font-semibold">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="page-width home-update-grid grid gap-8 py-14 md:items-center md:py-16">
          <div>
            <p className="eyebrow">{copy.updates}</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">{copy.articleTitle}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {copy.articleSummary}
            </p>
          </div>
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            href={`${prefix}/updates`}
          >
            {locale === "en" ? "Read the project story" : "阅读项目介绍"}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
