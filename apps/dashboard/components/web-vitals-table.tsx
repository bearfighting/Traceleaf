import React from "react";

import { DisabledState } from "./states/disabled-state";
import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";
import { UnavailableState } from "./states/unavailable-state";

import type { WebVitalsResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";
export function WebVitalsTable({
  context,
  state,
}: {
  context: DashboardOverviewContext;
  state: DashboardReportState<WebVitalsResponse>;
}) {
  return (
    <section className="card scroll-mt-6" id="web-vitals" aria-labelledby="web-vitals-heading">
      <h2 id="web-vitals-heading">Web Vitals</h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <DisabledState context={context} label="Web Vitals" />
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Web Vitals" />
      ) : state.data.items.length === 0 ? (
        <EmptyState context={context} />
      ) : (
        <table className="data-table">
          <caption className="table-caption">Document load metrics by route</caption>
          <thead>
            <tr>
              <th>Route</th>
              <th>Metric</th>
              <th>Samples</th>
              <th>p75</th>
              <th>Good</th>
              <th>Needs improvement</th>
              <th>Poor</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((x) => (
              <tr key={`${x.path}:${x.metric}`}>
                <td>{x.path}</td>
                <td>{x.metric}</td>
                <td>{x.count}</td>
                <td>
                  {x.status === "insufficient_data"
                    ? "Insufficient data"
                    : `${x.p75} ${x.metric === "CLS" ? "" : "ms"}`}
                </td>
                <td>{x.good_count}</td>
                <td>{x.needs_improvement_count}</td>
                <td>{x.poor_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
