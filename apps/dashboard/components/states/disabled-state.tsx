import React from "react";

import { settingsRoute } from "../../lib/settings-routes";

import type { DashboardOverviewContext } from "../../lib/dashboard-overview";

export function DisabledState({
  context,
  label,
}: {
  context: DashboardOverviewContext;
  label: string;
}) {
  return (
    <p role="status">
      {label} analytics are not enabled for Site {context.siteId} ({context.dateRange.from} to{" "}
      {context.dateRange.to} UTC).{" "}
      <a href={settingsRoute("capabilities", settingsContext(context))}>Review capabilities</a>
    </p>
  );
}

function settingsContext(context: DashboardOverviewContext) {
  return {
    siteId: context.siteId,
    environment: context.environment,
    from: context.dateRange.from,
    to: context.dateRange.to,
    dimension: context.dimension,
    definitionVersion: context.definitionVersion,
  };
}
