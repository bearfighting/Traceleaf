import type { Metadata } from "next";

import { QuickStartPage } from "@/components/standard-pages";
import { SiteShell } from "@/components/site-shell";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: "快速开始" };

export default function SimplifiedChineseQuickStartRoute() {
  return (
    <SiteShell copy={translations["zh-cn"]} locale="zh-cn">
      <QuickStartPage copy={translations["zh-cn"]} locale="zh-cn" />
    </SiteShell>
  );
}
