import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Copy, Locale } from "@/lib/content";

export function SiteShell({
  children,
  locale,
  copy,
}: {
  children: ReactNode;
  locale: Locale;
  copy: Copy;
}) {
  return (
    <div className="site-layout" lang={locale === "en" ? "en" : "zh-CN"}>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-3"
        href="#main-content"
      >
        {locale === "en" ? "Skip to content" : "跳转到正文"}
      </a>
      <SiteHeader copy={copy} locale={locale} />
      {children}
      <SiteFooter copy={copy} locale={locale} />
    </div>
  );
}
