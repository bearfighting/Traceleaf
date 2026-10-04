import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VisitorSessionTrendTable } from "./visitor-session-trend-table";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-20", to: "2026-09-21" } };

describe("VisitorSessionTrendTable", () => {
  it("renders API daily order and all Phase 6 metrics", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            page_views: 5,
            unique_visitors: 2,
            sessions: 3,
            items: [{ day: "2026-09-20", page_views: 3, unique_visitors: 1, sessions: 2 }],
            data_as_of: "2026-09-21T12:00:00Z",
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("Unique Visitors");
    expect(markup).toContain("2026-09-20");
    expect(markup).toContain("3");
  });

  it("renders disabled state independently", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        state={{ status: "disabled", error: new Error("disabled") as never }}
      />,
    );

    expect(markup).toContain("Audience analytics are not enabled");
    expect(markup).toContain("/dashboard/settings/capabilities?site_id=site_playground");
  });

  it("renders a Phase 6 empty state", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            page_views: 0,
            unique_visitors: 0,
            sessions: 0,
            items: [],
            data_as_of: null,
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("No Phase 6 analytics data is available");
  });
});
