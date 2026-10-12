import type { Metadata } from "next";

import { SiteShell } from "@/components/site-shell";
import { ProductPage } from "@/components/standard-pages";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: "产品" };

export default function SimplifiedChineseProductRoute() {
  return (
    <SiteShell copy={translations["zh-cn"]} locale="zh-cn">
      <ProductPage copy={translations["zh-cn"]} locale="zh-cn" />
    </SiteShell>
  );
}
