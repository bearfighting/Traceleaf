import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsApiClientError } from "../../lib/analytics/analytics-api/errors";
import { DEFINITION_REPORT_ITEM_LIMIT } from "../../lib/analytics/dashboard-reports";

import { ConversionFunnelTables } from "./conversion-funnel-tables";

import type {
  ConversionReportResponse,
  FunnelReportResponse,
} from "../../lib/analytics/analytics-api/types";

const context = { siteId: "site_example", dateRange: { from: "2026-09-01", to: "2026-09-02" } };
const conversions: ConversionReportResponse = {
  site_id: "site_example",
  from: "2026-09-01",
  to: "2026-09-02",
  total: 2,
  definition_version: "v1",
  items: [
    {
      definition_id: "purchase",
      day: "2026-09-01",
      event_count: 2,
      converted_sessions: 1,
      eligible_sessions: 4,
      conversion_rate: 0.25,
    },
  ],
  chart_items: [
    {
      definition_id: "purchase",
      day: "2026-09-01",
      event_count: 2,
      converted_sessions: 1,
      eligible_sessions: 4,
      conversion_rate: 0.25,
    },
    {
      definition_id: "purchase",
      day: "2026-09-02",
      event_count: 0,
      converted_sessions: 0,
      eligible_sessions: 0,
      conversion_rate: 0,
    },
  ],
  data_as_of: null,
  freshness_status: "current",
  aggregation_version: 1,
};
const funnels: FunnelReportResponse = {
  site_id: "site_example",
  from: "2026-09-01",
  to: "2026-09-02",
  total: 1,
  definition_version: "v1",
  items: [
    {
      definition_id: "checkout",
      day: "2026-09-01",
      step_index: 1,
      sessions: 1,
      conversion_rate: 0.5,
    },
  ],
  data_as_of: null,
  freshness_status: "current",
  aggregation_version: 1,
};

describe("ConversionFunnelTables", () => {
  it("shows aggregate counts and rates without properties or visitor IDs", () => {
    const html = renderToStaticMarkup(
      <ConversionFunnelTables
        context={context}
        conversions={{ status: "success", data: conversions }}
        funnels={{ status: "success", data: funnels }}
      />,
    );
    expect(html).toContain("purchase");
    expect(html).toContain("25.0%");
    expect(html).toContain("checkout");
    expect(html).toContain("50.0%");
    expect(html).not.toContain("properties");
    expect(html).not.toContain("visitor_id");
  });

  it("shows N/A when the conversion rate has no eligible sessions", () => {
    const html = renderToStaticMarkup(
      <ConversionFunnelTables
        context={context}
        conversions={{
          status: "success",
          data: {
            ...conversions,
            items: [
              {
                ...conversions.items[0],
                converted_sessions: 0,
                eligible_sessions: 0,
                conversion_rate: 0,
              },
            ],
          },
        }}
        showFunnels={false}
      />,
    );

    expect(html).toContain("N/A");
    expect(html).not.toContain("0.0%");
  });

  it("shows empty and error states", () => {
    const empty = renderToStaticMarkup(
      <ConversionFunnelTables
        context={context}
        conversions={{ status: "success", data: { ...conversions, items: [], total: 0 } }}
        funnels={{ status: "success", data: { ...funnels, items: [], total: 0 } }}
      />,
    );
    expect(empty).toContain("No conversion data is available");
    expect(empty).toContain("No funnel data is available");
    expect(empty).toContain("Data freshness: current");
    const error = renderToStaticMarkup(
      <ConversionFunnelTables
        context={context}
        conversions={{
          status: "error",
          error: new AnalyticsApiClientError("Request failed", { kind: "network" }),
        }}
        funnels={{ status: "success", data: funnels }}
      />,
    );
    expect(error).toContain("Request failed");
  });

  it("warns when the definition report response reaches the API row limit", () => {
    const limitedConversions = {
      ...conversions,
      items: Array.from({ length: DEFINITION_REPORT_ITEM_LIMIT }, (_, index) => ({
        ...conversions.items[0],
        definition_id: `purchase-${index}`,
      })),
    };
    const limitedFunnels = {
      ...funnels,
      items: Array.from({ length: DEFINITION_REPORT_ITEM_LIMIT }, (_, index) => ({
        ...funnels.items[0],
        definition_id: `checkout-${index}`,
      })),
    };
    const html = renderToStaticMarkup(
      <ConversionFunnelTables
        context={context}
        conversions={{ status: "success", data: limitedConversions }}
        funnels={{ status: "success", data: limitedFunnels }}
      />,
    );

    expect(html).toContain(
      "Showing up to 20 conversion report rows; this result may be truncated.",
    );
    expect(html).toContain("Showing up to 20 funnel report rows; this result may be truncated.");
  });
});
