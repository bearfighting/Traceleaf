import React from "react";

import { DisabledState } from "./states/disabled-state";
import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";
import { UnavailableState } from "./states/unavailable-state";

import type { DimensionResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

interface DimensionReportTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<DimensionResponse>;
}

export function DimensionReportTable({ context, state }: DimensionReportTableProps) {
  return (
    <section className="card scroll-mt-6" id="dimensions" aria-labelledby="dimension-heading">
      <h2 id="dimension-heading">Dimension Report</h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <DisabledState context={context} label="Dimension" />
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Dimension" />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          context={context}
          message="No Phase 6 analytics data is available for this selection."
        />
      ) : (
        <table className="data-table">
          <caption className="table-caption">
            {state.data.dimension} values ordered by page views
          </caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Page Views</th>
              <th scope="col">Unique Visitors</th>
              <th scope="col">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((item) => (
              <tr key={item.value}>
                <td>{item.value}</td>
                <td>{item.page_views}</td>
                <td>{item.unique_visitors}</td>
                <td>{item.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
