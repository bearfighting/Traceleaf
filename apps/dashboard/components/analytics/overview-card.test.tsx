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
        metric="page_views"
        value={4}
      />,
    );

    expect(markup).toContain("Selected range Page Views");
    expect(markup).toContain('data-metric="page_views" data-value="4"');
    expect(markup).toContain("Site: site_playground");
    expect(markup).toContain("2026-09-01 to 2026-09-18 UTC");
  });

  it("renders zero as a successful metric", () => {
    const markup = renderToStaticMarkup(
      <OverviewCard
        context={{ siteId: "site_playground", dateRange: { from: "2026-09-01", to: "2026-09-01" } }}
        label="Site total Page Views"
        metric="page_views"
        value={0}
      />,
    );

    expect(markup).toContain('data-metric="page_views" data-value="0"');
  });

  it("identifies visitor and session metrics without labeling them as page views", () => {
    const markup = renderToStaticMarkup(
      <OverviewCard
        context={{ siteId: "site_playground", dateRange: { from: "2026-09-01", to: "2026-09-01" } }}
        label="Sessions"
        metric="sessions"
        value={3}
      />,
    );

    expect(markup).toContain('data-metric="sessions" data-value="3"');
    expect(markup).not.toContain("data-page-views");
  });
});
