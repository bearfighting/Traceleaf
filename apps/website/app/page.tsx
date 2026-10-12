import { HomeContent } from "@/components/home-content";
import { SiteShell } from "@/components/site-shell";
import { translations } from "@/lib/content";

export default function HomePage() {
  return (
    <SiteShell copy={translations.en} locale="en">
      <HomeContent copy={translations.en} locale="en" />
    </SiteShell>
  );
}
