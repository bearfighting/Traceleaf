import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeControl } from "@/components/theme-control";
import type { Copy, Locale } from "@/lib/content";

function TraceleafMark() {
  return (
    <svg aria-hidden="true" className="size-8 text-primary" fill="none" viewBox="0 0 36 36">
      <path
        d="M18 30.5c-1.8-6.6-7.9-8.1-9.5-14.3C7 10.4 12.1 6 18.7 5.5c.6 6.8 5.6 9.6 5 15.2-.4 4.1-2.7 7.5-5.7 9.8Z"
        fill="currentColor"
        opacity=".2"
      />
      <path
        d="M18 30.5c-1.8-6.6-7.9-8.1-9.5-14.3C7 10.4 12.1 6 18.7 5.5c.6 6.8 5.6 9.6 5 15.2-.4 4.1-2.7 7.5-5.7 9.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M11.5 14.5c4.3 2.6 6.5 6.7 6.7 12.6m.2-6.7c1.6-2.6 3.8-4.3 6.5-5.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

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
          aria-label="Traceleaf home"
          className="inline-flex shrink-0 items-center gap-2.5"
          href={base || "/"}
        >
          <TraceleafMark />
          <span className="text-lg font-semibold tracking-tight">Traceleaf</span>
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
