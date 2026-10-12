import type { Metadata } from "next";

import { SiteShell } from "@/components/site-shell";
import { UpdateArticle } from "@/components/standard-pages";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: translations["zh-cn"].articleTitle };

export default function SimplifiedChineseProjectStoryRoute() {
  return (
    <SiteShell copy={translations["zh-cn"]} locale="zh-cn">
      <UpdateArticle copy={translations["zh-cn"]} locale="zh-cn" />
    </SiteShell>
  );
}
