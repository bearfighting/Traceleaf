import type { Metadata } from "next";

import { SiteShell } from "@/components/site-shell";
import { UpdateArticle } from "@/components/standard-pages";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: translations.en.articleTitle };

export default function ProjectStoryRoute() {
  return (
    <SiteShell copy={translations.en} locale="en">
      <UpdateArticle copy={translations.en} locale="en" />
    </SiteShell>
  );
}
