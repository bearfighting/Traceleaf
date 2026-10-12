import type { Metadata } from "next";

import { SiteShell } from "@/components/site-shell";
import { UpdatesPage } from "@/components/standard-pages";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: "项目动态" };

export default function SimplifiedChineseUpdatesRoute() {
  return (
    <SiteShell copy={translations["zh-cn"]} locale="zh-cn">
      <UpdatesPage copy={translations["zh-cn"]} locale="zh-cn" />
    </SiteShell>
  );
}
