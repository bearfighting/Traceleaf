import { describe, expect, it, vi } from "vitest";

import { AnalyticsApiClientError } from "./analytics-api/errors";
import { loadDashboardOverview } from "./dashboard-overview";

import type { AnalyticsApiClient } from "./analytics-api/client";

const context = {
  siteId: "site_playground",
  dateRange: { from: "2026-09-01", to: "2026-09-18" },
};

function createClient(overrides: Partial<AnalyticsApiClient> = {}): AnalyticsApiClient {
  return {
    overview: vi.fn().mockResolvedValue({ site_id: context.siteId, page_views: 12 }),
    rangeOverview: vi.fn().mockResolvedValue({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      page_views: 4,
    }),
    timeline: vi.fn(),
    pages: vi.fn(),
    events: vi.fn(),
    visitors: vi.fn(),
    geoCountries: vi.fn(),
    sessions: vi.fn(),
    dimension: vi.fn(),
    ...overrides,
  };
}

describe("loadDashboardOverview", () => {
  it("queries all-time and selected-range overview in parallel with the current context", async () => {
    const client = createClient();

    const result = await loadDashboardOverview(context, { client });

    expect(result).toEqual({
      status: "success",
      context,
      data: {
        overview: { site_id: "site_playground", page_views: 12 },
        rangeOverview: {
          site_id: "site_playground",
          from: "2026-09-01",
          to: "2026-09-18",
          page_views: 4,
        },
      },
    });
    expect(client.overview).toHaveBeenCalledWith("site_playground");
    expect(client.rangeOverview).toHaveBeenCalledWith(
      "site_playground",
      "2026-09-01",
      "2026-09-18",
    );
    expect(client.timeline).not.toHaveBeenCalled();
    expect(client.pages).not.toHaveBeenCalled();
  });

  it("preserves successful zero values", async () => {
    const client = createClient({
      overview: vi.fn().mockResolvedValue({ site_id: context.siteId, page_views: 0 }),
      rangeOverview: vi.fn().mockResolvedValue({
        site_id: context.siteId,
        from: context.dateRange.from,
        to: context.dateRange.to,
        page_views: 0,
      }),
    });

    const result = await loadDashboardOverview(context, { client });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.data.overview.page_views).toBe(0);
      expect(result.data.rangeOverview.page_views).toBe(0);
    }
  });

  it.each(["overview", "rangeOverview"] as const)(
    "returns an error state when %s fails",
    async (failedQuery) => {
      const error = new AnalyticsApiClientError("Analytics API failed", {
        kind: "http",
        status: 503,
        code: "analytics_api_error",
      });
      const client = createClient({ [failedQuery]: vi.fn().mockRejectedValue(error) });

      const result = await loadDashboardOverview(context, { client });

      expect(result).toEqual({ status: "error", context, error });
    },
  );

  it("does not create a client or query when the API URL is invalid", async () => {
    const createClientMock = vi.fn();
    const result = await loadDashboardOverview(context, {
      getApiUrl: () => {
        throw new AnalyticsApiClientError("Missing Analytics API URL", { kind: "config" });
      },
      createClient: createClientMock,
    });

    expect(result.status).toBe("error");
    expect(result).toMatchObject({ context, error: { kind: "config" } });
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
