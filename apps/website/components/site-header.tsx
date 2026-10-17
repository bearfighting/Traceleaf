import Image from "next/image";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeControl } from "@/components/theme-control";
import type { Copy, Locale } from "@/lib/content";

export function SiteHeader({ locale, copy }: { locale: Locale; copy: Copy }) {
  const base = locale === "en" ? "" : "/zh-cn";
  const links = [
    { href: base || "/", label: copy.home },
    { href: `${base}/docs/quick-start`, label: copy.docs },
    { href: `${base}/product`, label: copy.product },
    { href: `${base}/updates`, label: copy.updates },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="page-width flex h-18 items-center justify-between gap-5">
        <Link
          aria-label={locale === "en" ? "Traceleaf home" : "Traceleaf 首页"}
          className="inline-flex shrink-0 items-center gap-2.5"
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
          <span className="text-lg font-semibold tracking-tight">traceleaf</span>
        </Link>

        <nav aria-label={copy.navTitle} className="hidden items-center gap-1 md:flex">
          {links.map((link, index) => (
            <Link
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground ${index === 0 ? "text-foreground" : "text-muted-foreground"}`}
              href={link.href}
              key={link.label}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher locale={locale} />
          <ThemeControl label={locale === "en" ? "Theme" : "主题"} />
          <details className="relative md:hidden">
            <summary
              aria-label={locale === "en" ? "Open navigation" : "打开导航菜单"}
              className="flex size-10 list-none cursor-pointer items-center justify-center rounded-md border border-border bg-card text-foreground"
            >
              <span aria-hidden="true">☰</span>
            </summary>
            <nav className="absolute right-0 top-12 flex w-52 flex-col rounded-xl border border-border bg-card p-2 shadow-lg">
              {links.map((link) => (
                <Link
                  className="rounded-md px-3 py-2.5 text-sm hover:bg-muted"
                  href={link.href}
                  key={link.label}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
