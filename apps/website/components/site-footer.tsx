import Image from "next/image";
import Link from "next/link";

import type { Copy, Locale } from "@/lib/content";

export function SiteFooter({ locale, copy }: { locale: Locale; copy: Copy }) {
  const base = locale === "en" ? "" : "/zh-cn";

  return (
    <footer className="border-t border-border bg-surface-subtle">
      <div className="page-width footer-grid grid gap-10 py-12 sm:items-end">
        <div className="max-w-md">
          <Link
            aria-label={locale === "en" ? "Traceleaf home" : "Traceleaf 首页"}
            className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight"
            href={base || "/"}
          >
            <Image
              alt=""
              aria-hidden="true"
              className="size-8"
              height="64"
              src="/traceleaf-symbol.svg"
              width="64"
            />
            <span>traceleaf</span>
          </Link>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.footerLine}</p>
        </div>
        <nav
          aria-label={locale === "en" ? "Footer" : "页尾导航"}
          className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground"
        >
          <Link className="hover:text-foreground" href={base || "/"}>
            {copy.home}
          </Link>
          <Link className="hover:text-foreground" href={`${base}/docs/quick-start`}>
            {copy.quickStart}
          </Link>
          <Link className="hover:text-foreground" href={`${base}/product`}>
            {copy.product}
          </Link>
          <Link className="hover:text-foreground" href={`${base}/updates`}>
            {copy.updates}
          </Link>
          <Link className="hover:text-foreground" href="https://github.com/bearfighting/Traceleaf">
            GitHub
          </Link>
        </nav>
        <p className="text-xs text-muted-foreground sm:col-span-2">© 2026 Traceleaf · MIT</p>
      </div>
    </footer>
  );
}
