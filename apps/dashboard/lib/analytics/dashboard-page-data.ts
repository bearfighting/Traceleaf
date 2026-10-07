import { loadDefinitionRevisionHistory } from "../settings/definition-revision-history";

import { createAnalyticsApiClient } from "./analytics-api/client";
import { getAnalyticsApiUrl } from "./analytics-api/config";
import { AnalyticsApiClientError } from "./analytics-api/errors";
import { loadDashboardOverview } from "./dashboard-overview";
import { loadDashboardReports } from "./dashboard-reports";

import type { DashboardApiDependencies } from "../dashboard-dependencies";
import type { AnalyticsApiClient } from "./analytics-api/client";
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

export {
  loadDefinitionRevisionHistory,
  loadDefinitionRevisions,
} from "../settings/definition-revision-history";
