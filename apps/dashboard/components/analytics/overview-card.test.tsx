import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverviewCard } from "./overview-card";

describe("OverviewCard", () => {
  it("renders the metric and current dashboard context", () => {
    const markup = renderToStaticMarkup(
      <OverviewCard
        context={{
          siteId: "site_playground",
          dateRange: { from: "2026-09-01", to: "2026-09-18" },
        }}
        label="Selected range Page Views"
        pageViews={4}
      />,
    );

    expect(markup).toContain("Selected range Page Views");
    expect(markup).toContain('data-page-views="4"');
    expect(markup).toContain("Site: site_playground");
    expect(markup).toContain("2026-09-01 to 2026-09-18 UTC");
  });

  it("renders zero as a successful metric", () => {
    const markup = renderToStaticMarkup(
      <OverviewCard
        context={{ siteId: "site_playground", dateRange: { from: "2026-09-01", to: "2026-09-01" } }}
        label="Site total Page Views"
        pageViews={0}
      />,
    );

    expect(markup).toContain('data-page-views="0"');
  });
});
