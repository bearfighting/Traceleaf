import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsApiClientError } from "../../lib/analytics/analytics-api/errors";

import { WebVitalsTable } from "./web-vitals-table";

import type { WebVitalsResponse } from "../../lib/analytics/analytics-api/types";

const context = { siteId: "site_example", dateRange: { from: "2026-09-01", to: "2026-09-02" } };
const response: WebVitalsResponse = {
  site_id: "site_example",
  from: "2026-09-01",
  to: "2026-09-02",
  total: 3,
  items: [
    {
      path: "/pricing",
      metric: "LCP",
      count: 3,
      p75: null,
      good_count: 2,
      needs_improvement_count: 1,
      poor_count: 0,
      status: "insufficient_data",
    },
  ],
  data_as_of: null,
  freshness_status: "current",
  aggregation_version: 1,
};
describe("WebVitalsTable", () => {
  it("shows route, metric, rating counts, and low-sample status without properties", () => {
    const html = renderToStaticMarkup(
      <WebVitalsTable context={context} state={{ status: "success", data: response }} />,
    );
    expect(html).toContain("Insufficient data");
    expect(html).toContain("/pricing");
    expect(html).toContain("LCP");
    expect(html).not.toContain("properties");
  });
  it("shows empty and error states", () => {
    const empty = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{ status: "success", data: { ...response, items: [] } }}
      />,
    );
    expect(empty).toContain("No page view data");
    const error = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{
          status: "error",
          error: new AnalyticsApiClientError("Request failed", { kind: "network" }),
        }}
      />,
    );
    expect(error).toContain("Request failed");
  });

  it("shows unsupported API clients as unavailable, not as a disabled capability", () => {
    const unavailable = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{
          status: "unavailable",
          error: new AnalyticsApiClientError("Endpoint is missing", { kind: "unavailable" }),
        }}
      />,
    );

    expect(unavailable).toContain("not supported by the configured Analytics API client");
    expect(unavailable).not.toContain("not enabled");
    expect(unavailable).not.toContain("/dashboard/settings/capabilities");
  });
});
