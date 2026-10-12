import type { Metadata } from "next";

import { SiteShell } from "@/components/site-shell";
import { ProductPage } from "@/components/standard-pages";
import { translations } from "@/lib/content";

export const metadata: Metadata = { title: "Product" };

export default function ProductRoute() {
  return (
    <SiteShell copy={translations.en} locale="en">
      <ProductPage copy={translations.en} locale="en" />
    </SiteShell>
  );
}
