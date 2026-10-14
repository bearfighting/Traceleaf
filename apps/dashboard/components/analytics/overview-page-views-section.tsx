import React from "react";

import { EmptyState } from "../shared/states/empty-state";

import { OverviewPageViewsChart } from "./overview-page-views-chart";
import { TimelineTable } from "./timeline-table";

import type { TimelineResponse } from "../../lib/analytics/analytics-api/types";
import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";
import type { DashboardReportState } from "../../lib/analytics/dashboard-reports";

export function OverviewPageViewsSection({
  context,
  state,
}: {
  context: DashboardOverviewContext;
  state: DashboardReportState<TimelineResponse>;
}) {
  return (
    <section className="card report-card" aria-labelledby="overview-page-views-heading">
      <h2 id="overview-page-views-heading">Page Views by day</h2>
      {state.status === "success" ? (
        state.data.items.length === 0 ? (
          <EmptyState context={context} />
        ) : (
          <>
            <OverviewPageViewsChart items={state.data.items} />
            <details className="mt-4">
              <summary className="cursor-pointer">Show daily values</summary>
              <TimelineTable context={context} state={state} />
            </details>
          </>
        )
      ) : (
        <TimelineTable context={context} state={state} />
      )}
    </section>
  );
}
