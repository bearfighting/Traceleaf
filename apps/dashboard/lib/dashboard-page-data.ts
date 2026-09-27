import { createAnalyticsApiClient } from "./analytics-api/client";
import { getAnalyticsApiUrl } from "./analytics-api/config";
import { AnalyticsApiClientError } from "./analytics-api/errors";
import { loadDashboardOverview } from "./dashboard-overview";
import { loadDashboardReports } from "./dashboard-reports";

import type { AnalyticsApiClient } from "./analytics-api/client";
import type { DashboardApiDependencies } from "./dashboard-dependencies";
import type { DashboardOverviewContext, DashboardOverviewState } from "./dashboard-overview";
import type { DashboardReportsState } from "./dashboard-reports";

export interface DashboardPageData {
  overview: Exclude<DashboardOverviewState, { status: "loading" }>;
  reports: DashboardReportsState;
}

export async function loadDashboardPageData(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
): Promise<DashboardPageData> {
  let client: AnalyticsApiClient;

  try {
    client =
      dependencies.client ??
      (dependencies.createClient ?? createAnalyticsApiClient)({
        baseUrl: (dependencies.getApiUrl ?? getAnalyticsApiUrl)(),
      });
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return {
      overview: { status: "error", context, error },
      reports: {
        timeline: { status: "error", error },
        pages: { status: "error", error },
        events: { status: "error", error },
        geoCountries: { status: "error", error },
        webVitals: { status: "error", error },
        conversions: { status: "error", error },
        funnels: { status: "error", error },
        visitors: { status: "error", error },
        dimension: { status: "error", error },
      },
    };
  }

  const [overview, reports] = await Promise.all([
    loadDashboardOverview(context, { client }),
    loadDashboardReports(context, { client }),
  ]);

  return { overview, reports };
}

function toAnalyticsApiClientError(cause: unknown): AnalyticsApiClientError {
  if (cause instanceof AnalyticsApiClientError) {
    return cause;
  }

  return new AnalyticsApiClientError("Dashboard data could not be loaded.", {
    kind: "network",
    cause,
  });
}

export async function loadDefinitionRevisions(
  siteId: string,
): Promise<Array<{ version: string; revision: number }>> {
  try {
    const response = await fetch(
      `${getAnalyticsApiUrl()}/v1/sites/${encodeURIComponent(siteId)}/definition-revisions`,
      { cache: "no-store" },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      revisions?: Array<{ definition_version?: string; revision?: number }>;
    };

    return (body.revisions ?? [])
      .filter(
        (item): item is { definition_version: string; revision: number } =>
          typeof item.definition_version === "string" && typeof item.revision === "number",
      )
      .map((item) => ({ version: item.definition_version, revision: item.revision }));
  } catch {
    return [];
  }
}
