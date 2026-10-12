import type { Metadata } from "next";

import { SiteShell } from "@/components/site-shell";
import { UpdatesPage } from "@/components/standard-pages";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: "Updates" };

export default function UpdatesRoute() {
  return (
    <SiteShell copy={translations.en} locale="en">
      <UpdatesPage copy={translations.en} locale="en" />
    </SiteShell>
  );
}
