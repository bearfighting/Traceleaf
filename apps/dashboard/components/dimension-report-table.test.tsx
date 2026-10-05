import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DimensionReportTable } from "./dimension-report-table";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-20", to: "2026-09-21" } };

describe("DimensionReportTable", () => {
  it("renders the API-provided dimension ordering and values", () => {
    const markup = renderToStaticMarkup(
      <DimensionReportTable
        context={context}
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            dimension: "browser",
            items: [{ value: "unknown", page_views: 5, unique_visitors: 2, sessions: 3 }],
            data_as_of: null,
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("unknown");
    expect(markup).toContain("5");
  });

  it("renders an empty state", () => {
    const markup = renderToStaticMarkup(
      <DimensionReportTable
        context={context}
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            dimension: "browser",
            items: [],
            data_as_of: null,
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("No analytics data is available");
  });
});
