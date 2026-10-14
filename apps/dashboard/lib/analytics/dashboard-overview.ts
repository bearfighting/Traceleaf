import { createAnalyticsApiClient } from "./analytics-api/client";
import { getAnalyticsApiUrl } from "./analytics-api/config";
import { AnalyticsApiClientError } from "./analytics-api/errors";

import type { DashboardApiDependencies } from "../dashboard-dependencies";
import type { DashboardDateRange } from "../query-params";
import type { AnalyticsApiClient } from "./analytics-api/client";
import type {
  OverviewResponse,
  RangeOverviewResponse,
  TimelineResponse,
} from "./analytics-api/types";
import type { DashboardReportState } from "./dashboard-reports";

export interface DashboardOverviewContext {
  siteId: string;
  dateRange: DashboardDateRange;
  dimension?: import("./analytics-api/types").AnalyticsDimension;
  definitionVersion?: string;
  environment?: string;
}

export interface DashboardOverviewData {
  overview: OverviewResponse;
  rangeOverview: RangeOverviewResponse;
  timeline: DashboardReportState<TimelineResponse>;
}

export type DashboardOverviewState =
  | { status: "loading"; context: DashboardOverviewContext }
  | { status: "success"; context: DashboardOverviewContext; data: DashboardOverviewData }
  | { status: "error"; context: DashboardOverviewContext; error: AnalyticsApiClientError };

export async function loadDashboardOverview(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
): Promise<Exclude<DashboardOverviewState, { status: "loading" }>> {
  try {
    const client =
      dependencies.client ??
      (dependencies.createClient ?? createAnalyticsApiClient)({
        baseUrl: (dependencies.getApiUrl ?? getAnalyticsApiUrl)(),
      });
    const [overview, rangeOverview, timeline] = await Promise.all([
      client.overview(context.siteId),
      client.rangeOverview(context.siteId, context.dateRange.from, context.dateRange.to),
      settleTimeline(client, context),
    ]);

    return { status: "success", context, data: { overview, rangeOverview, timeline } };
  } catch (cause) {
    return { status: "error", context, error: toAnalyticsApiClientError(cause) };
  }
}

async function settleTimeline(
  client: AnalyticsApiClient,
  context: DashboardOverviewContext,
): Promise<DashboardReportState<TimelineResponse>> {
  try {
    const data = await client.timeline(
      context.siteId,
      context.dateRange.from,
      context.dateRange.to,
    );

    return { status: "success", data };
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return error.kind === "disabled"
      ? { status: "disabled", error }
      : error.kind === "unavailable"
        ? { status: "unavailable", error }
        : { status: "error", error };
  }
}

function toAnalyticsApiClientError(cause: unknown): AnalyticsApiClientError {
  if (cause instanceof AnalyticsApiClientError) {
    return cause;
  }

  return new AnalyticsApiClientError("Dashboard overview could not be loaded.", {
    kind: "network",
    cause,
  });
}
