import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EventReportTable } from "./event-report-table";

import type { EventsResponse } from "../../lib/analytics/analytics-api/types";

const context = {
  siteId: "site_playground",
  dateRange: { from: "2026-09-18", to: "2026-09-19" },
};

const response: EventsResponse = {
  site_id: context.siteId,
  from: context.dateRange.from,
  to: context.dateRange.to,
  total: 8,
  items: [
    { day: "2026-09-18", event_name: "purchase", event_count: 2 },
    { day: "2026-09-19", event_name: "purchase", event_count: 3 },
    { day: "2026-09-18", event_name: "checkout", event_count: 3 },
  ],
  data_as_of: "2026-09-19T12:00:00Z",
  freshness_status: "stale",
  aggregation_version: 1,
};

describe("EventReportTable", () => {
  it("preserves exact daily event detail and freshness", () => {
    const markup = renderToStaticMarkup(
      <EventReportTable context={context} state={{ status: "success", data: response }} />,
    );

    expect(markup).toContain("Custom Event counts by UTC date");
    expect(markup).not.toContain("Top custom events by count");
    expect(markup).toContain("2026-09-18</td><td>2</td>");
    expect(markup).toContain("2026-09-19</td><td>3</td>");
    expect(markup).toContain("Custom Events data freshness: stale");
    expect(markup).toContain("2026-09-19T12:00:00Z");
  });

  it("keeps the empty state when there are no event rows", () => {
    const markup = renderToStaticMarkup(
      <EventReportTable
        context={context}
        state={{ status: "success", data: { ...response, total: 0, items: [] } }}
      />,
    );

    expect(markup).toContain("No page view data is available for this selection.");
    expect(markup).toContain("Custom Events data freshness: stale");
  });
});
