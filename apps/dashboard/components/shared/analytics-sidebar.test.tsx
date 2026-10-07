import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsSidebar } from "./analytics-sidebar";

describe("AnalyticsSidebar", () => {
  it("provides grouped report routes in desktop and mobile navigation", () => {
    const markup = renderToStaticMarkup(<AnalyticsSidebar pathname="/dashboard/pages" />);

    expect(markup).toContain('aria-label="Analytics reports"');
    expect(markup).toContain("Browse reports");
    for (const route of [
      "/dashboard",
      "/dashboard/pages",
      "/dashboard/dimensions",
      "/dashboard/visitors",
      "/dashboard/sessions",
      "/dashboard/custom-events",
      "/dashboard/web-vitals",
      "/dashboard/countries",
      "/dashboard/conversions",
      "/dashboard/funnels",
    ]) {
      expect(markup).toContain(`href="${route}"`);
    }
    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
    expect(markup).toContain("Pages");
    expect(markup).not.toContain("Page views</a>");
  });

  it("styles the current report using the same aria-current value exposed to assistive technology", () => {
    const styles = readFileSync(
      fileURLToPath(new URL("../../styles/dashboard-navigation.css", import.meta.url)),
      "utf8",
    );

    expect(styles).toContain('.analytics-sidebar-link[aria-current="page"]');
    expect(styles).not.toContain('.analytics-sidebar-link[aria-current="location"]');
  });
});
