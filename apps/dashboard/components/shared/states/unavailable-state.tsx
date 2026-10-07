import React from "react";

import type { DashboardOverviewContext } from "../../../lib/analytics/dashboard-overview";

export function UnavailableState({
  context,
  label,
}: {
  context: DashboardOverviewContext;
  label: string;
}) {
  return (
    <p role="status">
      {label} reporting is not supported by the configured Analytics API client for Site{" "}
      {context.siteId} ({context.dateRange.from} to {context.dateRange.to} UTC).
    </p>
  );
}
