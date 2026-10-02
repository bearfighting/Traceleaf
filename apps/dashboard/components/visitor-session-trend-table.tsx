import React from "react";

import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";

import type { VisitorSessionResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

interface VisitorSessionTrendTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<VisitorSessionResponse>;
}

export function VisitorSessionTrendTable({ context, state }: VisitorSessionTrendTableProps) {
  return (
    <section className="card scroll-mt-6" id="visitors" aria-labelledby="visitor-session-heading">
      <h2 id="visitor-session-heading">Visitors and Sessions</h2>
      <span aria-hidden="true" className="report-anchor" id="sessions" />
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <p role="status">Phase 6 analytics is not enabled for this site.</p>
      ) : state.data.items.length === 0 ? (
        <EmptyState
          context={context}
          message="No Phase 6 analytics data is available for this selection."
        />
      ) : (
        <table className="data-table">
          <caption className="table-caption">Daily Visitor and Session metrics in UTC</caption>
          <thead>
            <tr>
              <th scope="col">UTC Date</th>
              <th scope="col">Page Views</th>
              <th scope="col">Unique Visitors</th>
              <th scope="col">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((item) => (
              <tr key={item.day}>
                <td>{item.day}</td>
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
