import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { AnalyticsApiClientError } from "./analytics-api/errors";
import {
  loadDashboardLegacyReport,
  loadDashboardPhase6Report,
  loadDashboardReports,
} from "./dashboard-reports";

import type { AnalyticsApiClient } from "./analytics-api/client";

const context = {
  siteId: "site_playground",
  dateRange: { from: "2026-09-18", to: "2026-09-18" },
};

const fixture = readFixture();
const emptyFixture = readFixture("empty-date-range.json");

function createClient(overrides: Partial<AnalyticsApiClient> = {}): AnalyticsApiClient {
  return {
    overview: vi.fn(),
    rangeOverview: vi.fn(),
    timeline: vi.fn().mockResolvedValue(fixture.timeline),
    pages: vi.fn().mockResolvedValue(fixture.pages),
    events: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      total: 0,
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    geoCountries: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      coverage_from: null,
      providers: [],
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    conversions: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      total: 0,
      definition_version: "1",
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    funnels: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      total: 0,
      definition_version: "1",
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    visitors: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      page_views: 0,
      unique_visitors: 0,
      sessions: 0,
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    sessions: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      page_views: 0,
      unique_visitors: 0,
      sessions: 0,
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    dimension: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      dimension: "browser",
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    }),
    ...overrides,
  };
}

function readFixture(filename = "multi-page-navigation.json") {
  const value = JSON.parse(
    readFileSync(
      new URL(
        `../../../protocol/contracts/analytics-api/current/fixtures/${filename}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    expected: {
      api: {
        timeline: { body: unknown };
        pages: { body: unknown };
      };
    };
  };

  return { timeline: value.expected.api.timeline.body, pages: value.expected.api.pages.body };
}

describe("loadDashboardReports", () => {
  it("loads only the endpoints required by the selected Legacy report", async () => {
    const client = createClient();

    const result = await loadDashboardLegacyReport(context, "countries", client);

    expect(client.geoCountries).toHaveBeenCalledOnce();
    expect(client.timeline).not.toHaveBeenCalled();
    expect(client.pages).not.toHaveBeenCalled();
    expect(client.events).not.toHaveBeenCalled();
    expect(client.visitors).not.toHaveBeenCalled();
    expect(result.geoCountries?.status).toBe("success");
  });

  it("queries only the selected Phase 6 report endpoint", async () => {
    const dimensionsClient = createClient();
    const dimensions = await loadDashboardPhase6Report(context, "dimensions", {
      client: dimensionsClient,
    });

    expect(dimensions).toMatchObject({ kind: "dimension", state: { status: "success" } });
    expect(dimensionsClient.dimension).toHaveBeenCalledOnce();
    expect(dimensionsClient.visitors).not.toHaveBeenCalled();
    expect(dimensionsClient.sessions).not.toHaveBeenCalled();

    const sessionsClient = createClient();
    const sessions = await loadDashboardPhase6Report(context, "sessions", {
      client: sessionsClient,
    });

    expect(sessions).toMatchObject({ kind: "audience", state: { status: "success" } });
    expect(sessionsClient.sessions).toHaveBeenCalledOnce();
    expect(sessionsClient.visitors).not.toHaveBeenCalled();
    expect(sessionsClient.dimension).not.toHaveBeenCalled();
  });

  it("queries timeline and pages in parallel with the current context", async () => {
    const client = createClient();
    const resultPromise = loadDashboardReports(context, { client });

    expect(client.timeline).toHaveBeenCalledWith("site_playground", "2026-09-18", "2026-09-18");
    expect(client.pages).toHaveBeenCalledWith("site_playground", "2026-09-18", "2026-09-18");
    expect(client.geoCountries).toHaveBeenCalledWith("site_playground", "2026-09-18", "2026-09-18");
    expect(client.conversions).toHaveBeenCalledWith(
      "site_playground",
      "2026-09-18",
      "2026-09-18",
      20,
      undefined,
      undefined,
    );
    expect(client.funnels).toHaveBeenCalledWith(
      "site_playground",
      "2026-09-18",
      "2026-09-18",
      20,
      undefined,
      undefined,
    );

    const result = await resultPromise;

    expect(result).toEqual({
      timeline: { status: "success", data: fixture.timeline },
      pages: { status: "success", data: fixture.pages },
      events: { status: "success", data: expect.any(Object) },
      geoCountries: { status: "success", data: expect.any(Object) },
      webVitals: { status: "success", data: expect.any(Object) },
      conversions: { status: "success", data: expect.any(Object) },
      funnels: { status: "success", data: expect.any(Object) },
      visitors: { status: "success", data: expect.any(Object) },
      dimension: { status: "success", data: expect.any(Object) },
    });
  });

  it("keeps timeline and pages errors independent", async () => {
    const timelineError = new AnalyticsApiClientError("Timeline failed", {
      kind: "http",
      status: 503,
    });
    const pagesError = new AnalyticsApiClientError("Pages failed", {
      kind: "http",
      status: 502,
    });
    const timelineClient = createClient({ timeline: vi.fn().mockRejectedValue(timelineError) });
    const pagesClient = createClient({ pages: vi.fn().mockRejectedValue(pagesError) });

    await expect(loadDashboardReports(context, { client: timelineClient })).resolves.toMatchObject({
      timeline: { status: "error", error: timelineError },
      pages: { status: "success" },
    });
    await expect(loadDashboardReports(context, { client: pagesClient })).resolves.toMatchObject({
      timeline: { status: "success" },
      pages: { status: "error", error: pagesError },
    });
  });

  it("preserves empty canonical report responses", async () => {
    const client = createClient({
      timeline: vi.fn().mockResolvedValue(emptyFixture.timeline),
      pages: vi.fn().mockResolvedValue(emptyFixture.pages),
    });

    const result = await loadDashboardReports(context, { client });

    expect(result).toEqual({
      timeline: { status: "success", data: emptyFixture.timeline },
      pages: { status: "success", data: emptyFixture.pages },
      events: { status: "success", data: expect.any(Object) },
      geoCountries: { status: "success", data: expect.any(Object) },
      webVitals: { status: "success", data: expect.any(Object) },
      conversions: { status: "success", data: expect.any(Object) },
      funnels: { status: "success", data: expect.any(Object) },
      visitors: { status: "success", data: expect.any(Object) },
      dimension: { status: "success", data: expect.any(Object) },
    });
  });

  it("returns independent config errors without making requests", async () => {
    const clientFactory = vi.fn();

    const result = await loadDashboardReports(context, {
      getApiUrl: () => {
        throw new AnalyticsApiClientError("Missing Analytics API URL", { kind: "config" });
      },
      createClient: clientFactory,
    });

    expect(result.timeline.status).toBe("error");
    expect(result.pages.status).toBe("error");
    expect(result.events.status).toBe("error");
    expect(result.conversions.status).toBe("error");
    expect(result.funnels.status).toBe("error");
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
