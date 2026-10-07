import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadReport } = vi.hoisted(() => ({ loadReport: vi.fn() }));

vi.mock("../../lib/analytics/dashboard-reports", () => ({
  loadAudienceDimensionReport: loadReport,
}));

import { AudienceDimensionReportSections } from "./audience-dimension-report-sections";

import type { AnalyticsApiClient } from "../../lib/analytics/analytics-api/client";

const context = {
  siteId: "site_playground",
  dateRange: { from: "2026-09-18", to: "2026-09-18" },
};

describe("AudienceDimensionReportSections", () => {
  beforeEach(() => loadReport.mockReset());

  it("shows an audience query error in the Overview summary", async () => {
    loadReport.mockResolvedValue({
      kind: "audience",
      state: { status: "error", error: { message: "Visitor query failed" } },
    });

    const element = await AudienceDimensionReportSections({
      context,
      client: {} as AnalyticsApiClient,
      report: "overview",
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Visitor query failed");
  });

  it("shows a distinct disabled state in the Overview summary", async () => {
    loadReport.mockResolvedValue({
      kind: "audience",
      state: { status: "disabled", error: { message: "disabled" } },
    });

    const element = await AudienceDimensionReportSections({
      context,
      client: {} as AnalyticsApiClient,
      report: "overview",
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Audience analytics are not enabled for Site site_playground");
    expect(markup).toContain("/dashboard/settings/capabilities?site_id=site_playground");
  });

  it("shows the Audience data freshness state in the Overview summary", async () => {
    loadReport.mockResolvedValue({
      kind: "audience",
      state: {
        status: "success",
        data: {
          site_id: context.siteId,
          from: context.dateRange.from,
          to: context.dateRange.to,
          page_views: 5,
          unique_visitors: 2,
          sessions: 3,
          items: [],
          data_as_of: "2026-09-18T12:00:00Z",
          freshness_status: "stale",
          aggregation_version: 1,
        },
      },
    });

    const element = await AudienceDimensionReportSections({
      context,
      client: {} as AnalyticsApiClient,
      report: "overview",
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Data may be stale");
    expect(markup).toContain("Unique Visitors");
  });

  it("renders the Dimensions table from its selected report state", async () => {
    loadReport.mockResolvedValue({
      kind: "dimension",
      state: {
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
      },
    });

    const element = await AudienceDimensionReportSections({
      context,
      client: {} as AnalyticsApiClient,
      report: "dimensions",
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Dimension Report");
  });
});
