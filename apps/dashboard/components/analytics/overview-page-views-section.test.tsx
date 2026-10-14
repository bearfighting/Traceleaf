import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsApiClientError } from "../../lib/analytics/analytics-api/errors";

import { OverviewPageViewsSection } from "./overview-page-views-section";

import type { TimelineResponse } from "../../lib/analytics/analytics-api/types";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-01", to: "2026-09-02" } };

function response(items: TimelineResponse["items"]): TimelineResponse {
  return { site_id: context.siteId, from: context.dateRange.from, to: context.dateRange.to, items };
}

describe("OverviewPageViewsSection", () => {
  it("renders API values in the chart and provides the same values in a collapsed UTC table", () => {
    const markup = renderToStaticMarkup(
      <OverviewPageViewsSection
        context={context}
        state={{
          status: "success",
          data: response([
            { day: "2026-09-02", page_views: 0 },
            { day: "2026-09-01", page_views: 7 },
          ]),
        }}
      />,
    );

    expect(markup).toContain("Page Views by day");
    expect(markup).toContain("Page Views by UTC date");
    expect(markup).toContain("Show daily values");
    expect(markup).toContain("<details");
    expect(markup).toContain("2026-09-02");
    expect(markup).toContain("2026-09-01");
    expect(markup).toContain("UTC Date");
    expect(markup).toContain("7");
    expect(markup).toContain(">0</td>");
  });

  it("renders the shared empty state for an empty Timeline", () => {
    const markup = renderToStaticMarkup(
      <OverviewPageViewsSection
        context={context}
        state={{ status: "success", data: response([]) }}
      />,
    );

    expect(markup).toContain("No page view data is available for this selection.");
    expect(markup).not.toContain("<svg");
  });

  it("renders Timeline errors independently with context", () => {
    const markup = renderToStaticMarkup(
      <OverviewPageViewsSection
        context={context}
        state={{
          status: "error",
          error: new AnalyticsApiClientError("Timeline failed", { kind: "http", status: 503 }),
        }}
      />,
    );

    expect(markup).toContain("Timeline failed");
    expect(markup).toContain("site_playground");
    expect(markup).toContain("2026-09-01 to 2026-09-02 UTC");
  });
});
