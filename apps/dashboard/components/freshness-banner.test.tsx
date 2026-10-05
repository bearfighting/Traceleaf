import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FreshnessBanner } from "./freshness-banner";

import type { DimensionResponse, VisitorSessionResponse } from "../lib/analytics-api/types";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-20", to: "2026-09-21" } };

function response(
  freshness_status: "current" | "stale" | "rebuilding" | "failed",
  data_as_of: string | null,
): VisitorSessionResponse {
  return {
    site_id: context.siteId,
    from: context.dateRange.from,
    to: context.dateRange.to,
    page_views: 5,
    unique_visitors: 2,
    sessions: 3,
    items: [],
    data_as_of,
    freshness_status,
    aggregation_version: 1,
  };
}

function dimensionResponse(
  freshness_status: "current" | "stale" | "rebuilding" | "failed",
  data_as_of: string | null,
): DimensionResponse {
  return {
    site_id: context.siteId,
    from: context.dateRange.from,
    to: context.dateRange.to,
    dimension: "browser",
    items: [],
    data_as_of,
    freshness_status,
    aggregation_version: 1,
  };
}

describe("FreshnessBanner", () => {
  it.each([
    ["current", "Data as of"],
    ["stale", "Data may be stale"],
    ["rebuilding", "Analytics are rebuilding"],
    ["failed", "Analytics rebuild failed"],
  ] as const)("renders the %s state", (status, message) => {
    const markup = renderToStaticMarkup(
      <FreshnessBanner
        context={context}
        visitorState={{ status: "success", data: response(status, "2026-09-21T12:00:00Z") }}
        dimensionState={{ status: "error", error: new Error("dimension failed") as never }}
      />,
    );

    expect(markup).toContain(message);
  });

  it("does not invent a timestamp for empty data", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBanner
        context={context}
        visitorState={{ status: "success", data: response("current", null) }}
        dimensionState={{
          status: "success",
          data: dimensionResponse("current", null),
        }}
      />,
    );

    expect(markup).toContain("No analytics data is available");
    expect(markup).not.toContain("Data as of");
  });

  it("uses the highest severity across successful reports", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBanner
        context={context}
        visitorState={{ status: "success", data: response("current", "2026-09-21T12:00:00Z") }}
        dimensionState={{
          status: "success",
          data: dimensionResponse("failed", "2026-09-21T11:00:00Z"),
        }}
      />,
    );

    expect(markup).toContain("Analytics rebuild failed");
    expect(markup).toContain("2026-09-21 11:00:00 UTC");
  });
});
