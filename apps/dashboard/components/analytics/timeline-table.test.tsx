import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsApiClientError } from "../../lib/analytics/analytics-api/errors";

import { TimelineTable } from "./timeline-table";

import type { TimelineResponse } from "../../lib/analytics/analytics-api/types";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-17", to: "2026-09-18" } };

describe("TimelineTable", () => {
  it("renders API order without recomputing values", () => {
    const data: TimelineResponse = {
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      items: [
        { day: "2026-09-18", page_views: 3 },
        { day: "2026-09-17", page_views: 1 },
      ],
    };

    const markup = renderToStaticMarkup(
      <TimelineTable context={context} state={{ status: "success", data }} />,
    );

    expect(markup.indexOf("2026-09-18")).toBeLessThan(markup.indexOf("2026-09-17"));
    expect(markup).toContain("3");
    expect(markup).toContain("1");
  });

  it("renders an empty state for an empty response", () => {
    const data: TimelineResponse = {
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      items: [],
    };

    const markup = renderToStaticMarkup(
      <TimelineTable context={context} state={{ status: "success", data }} />,
    );

    expect(markup).toContain("No page view data is available for this selection.");
  });

  it("renders an error state with query context", () => {
    const markup = renderToStaticMarkup(
      <TimelineTable
        context={context}
        state={{
          status: "error",
          error: new AnalyticsApiClientError("Timeline unavailable", {
            kind: "http",
            status: 503,
          }),
        }}
      />,
    );

    expect(markup).toContain("Timeline unavailable");
    expect(markup).toContain("site_playground");
    expect(markup).toContain("2026-09-17 to 2026-09-18 UTC");
  });
});
