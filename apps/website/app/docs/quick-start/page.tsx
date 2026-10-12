import type { Metadata } from "next";

import { QuickStartPage } from "@/components/standard-pages";
import { SiteShell } from "@/components/site-shell";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: "Quick start" };

export default function QuickStartRoute() {
  return (
    <SiteShell copy={translations.en} locale="en">
      <QuickStartPage copy={translations.en} locale="en" />
    </SiteShell>
  );
}
