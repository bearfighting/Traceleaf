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
});
