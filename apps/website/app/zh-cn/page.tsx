import { HomeContent } from "@/components/home-content";
import { SiteShell } from "@/components/site-shell";
import { translations } from "@/lib/content";

export default function SimplifiedChineseHomePage() {
  return (
    <SiteShell copy={translations["zh-cn"]} locale="zh-cn">
      <HomeContent copy={translations["zh-cn"]} locale="zh-cn" />
    </SiteShell>
  );
}
