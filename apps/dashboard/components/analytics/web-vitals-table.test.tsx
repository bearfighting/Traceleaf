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
    {
      path: "/about",
      metric: "LCP",
      count: 5,
      p75: 2800,
      good_count: 2,
      needs_improvement_count: 2,
      poor_count: 1,
      status: "available",
    },
    ...(["INP", "CLS", "FCP", "TTFB"] as const).map((metric) => ({
      path: "/pricing",
      metric,
      count: 4,
      p75: metric === "CLS" ? 0.15 : 1200,
      good_count: 1,
      needs_improvement_count: 2,
      poor_count: 1,
      status: "available" as const,
    })),
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
    expect(html).toContain("Needs improvement");
    expect(html).toContain("CLS p75 by route");
    expect(html).toContain("Good");
    expect(html).toContain("2800 ms");
    expect(html).toContain("0.15");
    expect(html).toContain("Web Vitals data freshness: current");
    expect(html.indexOf("/pricing")).toBeLessThan(html.indexOf("/about"));
    expect(html).not.toContain("properties");

    const lowSampleOnly = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{ status: "success", data: { ...response, items: [response.items[0]] } }}
      />,
    );
    expect(lowSampleOnly).toContain("p75 unavailable because no route has enough samples.");
    expect(lowSampleOnly).not.toContain('aria-label="LCP p75 by route ms"');
  });
  it("shows empty and error states", () => {
    const empty = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{
          status: "success",
          data: { ...response, items: [], freshness_status: "stale" },
        }}
      />,
    );
    expect(empty).toContain("No page view data");
    expect(empty).toContain("Web Vitals data freshness: stale");
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
    const disabled = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{
          status: "disabled",
          error: new AnalyticsApiClientError("Web Vitals are disabled", { kind: "disabled" }),
        }}
      />,
    );
    expect(disabled).toContain("not enabled");
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

  it("shows non-current freshness while preserving exact table values", () => {
    const html = renderToStaticMarkup(
      <WebVitalsTable
        context={context}
        state={{
          status: "success",
          data: { ...response, freshness_status: "stale", data_as_of: "2026-09-02T12:00:00Z" },
        }}
      />,
    );
    expect(html).toContain("Web Vitals data freshness: stale");
    expect(html).toContain("2800 ms");
    expect(html).toContain("5</td>");
  });
});
