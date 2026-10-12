"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Locale } from "@/lib/content";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname() || "/";
  const target =
    locale === "en"
      ? `/zh-cn${pathname === "/" ? "" : pathname}`
      : pathname.replace(/^\/zh-cn/, "") || "/";

  return (
    <Link
      aria-label={locale === "en" ? "简体中文" : "English"}
      className="inline-flex min-h-10 items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      href={target}
    >
      {locale === "en" ? "中文" : "EN"}
    </Link>
  );
}
