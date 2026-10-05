import React from "react";

import type { DimensionResponse, VisitorSessionResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

interface FreshnessBannerProps {
  context?: DashboardOverviewContext;
  visitorState?: DashboardReportState<VisitorSessionResponse>;
  dimensionState?: DashboardReportState<DimensionResponse>;
}

export function FreshnessBanner({ visitorState, dimensionState }: FreshnessBannerProps) {
  const responses = [visitorState, dimensionState].flatMap((state) =>
    state?.status === "success" ? [state.data] : [],
  );
  if (responses.length === 0) return null;

  const dataAsOf = responses
    .map((state) => state.data_as_of)
    .filter((value): value is string => value !== null)
    .sort()[0];
  const freshnessStatus = ["failed", "rebuilding", "stale", "current"].find((status) =>
    responses.some((state) => state.freshness_status === status),
  ) as VisitorSessionResponse["freshness_status"] | undefined;
  if (!dataAsOf) {
    return <p className="freshness-banner">No analytics data is available for this selection.</p>;
  }

  if (!freshnessStatus) return null;

  const message = {
    current: `Data as of ${formatTimestamp(dataAsOf)} UTC`,
    stale: `Data may be stale. Data as of ${formatTimestamp(dataAsOf)} UTC`,
    rebuilding: `Analytics are rebuilding. Showing the last active generation as of ${formatTimestamp(dataAsOf)} UTC`,
    failed: `Analytics rebuild failed. Showing the last active generation as of ${formatTimestamp(dataAsOf)} UTC`,
  }[freshnessStatus];

  return (
    <p className={`freshness-banner freshness-${freshnessStatus}`} role="status">
      {message}
    </p>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", "");
}
