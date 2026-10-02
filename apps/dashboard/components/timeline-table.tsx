import React from "react";

import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";

import type { TimelineResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

interface TimelineTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<TimelineResponse>;
}

export function TimelineTable({ context, state }: TimelineTableProps) {
  return (
    <section className="card scroll-mt-6" id="timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">Timeline</h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <p role="status">Page View analytics is not enabled for this site.</p>
      ) : state.data.items.length === 0 ? (
        <EmptyState context={context} />
      ) : (
        <table className="data-table">
          <caption className="table-caption">Daily Page Views in UTC</caption>
          <thead>
            <tr>
              <th scope="col">UTC Date</th>
              <th scope="col">Page Views</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((item) => (
              <tr key={item.day}>
                <td>{item.day}</td>
                <td>{item.page_views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
