import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsApiClientError } from "../../lib/analytics/analytics-api/errors";

import { GeoCountryTable } from "./geo-country-table";

const context = { siteId: "site_example", dateRange: { from: "2026-09-01", to: "2026-09-02" } };
const response = {
  site_id: "site_example",
  from: "2026-09-01",
  to: "2026-09-02",
  coverage_from: "2026-09-01",
  providers: ["maxmind"],
  data_as_of: "2026-09-02T12:00:00Z",
  freshness_status: "current" as const,
  aggregation_version: 1,
  items: [
    { country_code: "CA", page_views: 4 },
    { country_code: "unknown", page_views: 1 },
  ],
};

describe("GeoCountryTable", () => {
  it("shows country codes and unknown counts", () => {
    const html = renderToStaticMarkup(
      <GeoCountryTable context={context} state={{ status: "success", data: response }} />,
    );
    expect(html).toContain("CA");
    expect(html).toContain("Unknown");
    expect(html).toContain("Page Views by country");
    expect(html).not.toContain("IP geolocation by");
  });

  it("shows DB-IP attribution when the date range includes DB-IP data", () => {
    const html = renderToStaticMarkup(
      <GeoCountryTable
        context={context}
        state={{ status: "success", data: { ...response, providers: ["db-ip"] } }}
      />,
    );
    expect(html).toContain('href="https://db-ip.com"');
    expect(html).toContain("IP geolocation by");
  });

  it("shows freshness state and historical coverage warning", () => {
    const html = renderToStaticMarkup(
      <GeoCountryTable
        context={context}
        state={{
          status: "success",
          data: { ...response, coverage_from: "2026-09-02", freshness_status: "stale" },
        }}
      />,
    );
    expect(html).toContain("Geo report data freshness: stale");
    expect(html).toContain("Earlier Page Views are not included");
  });

  it("shows failed rebuild as an alert", () => {
    const html = renderToStaticMarkup(
      <GeoCountryTable
        context={context}
        state={{ status: "success", data: { ...response, freshness_status: "failed" } }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("freshness: failed");
  });

  it("shows empty and error states", () => {
    const empty = renderToStaticMarkup(
      <GeoCountryTable
        context={context}
        state={{ status: "success", data: { ...response, items: [] } }}
      />,
    );
    expect(empty).toContain("No page view data");
    const error = renderToStaticMarkup(
      <GeoCountryTable
        context={context}
        state={{
          status: "error",
          error: new AnalyticsApiClientError("Report failed", { kind: "network" }),
        }}
      />,
    );
    expect(error).toContain("Report failed");
  });
});
