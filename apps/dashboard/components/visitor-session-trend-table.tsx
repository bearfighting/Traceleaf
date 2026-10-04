import React from "react";

import { DisabledState } from "./states/disabled-state";
import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";
import { UnavailableState } from "./states/unavailable-state";
import { Table } from "./ui";

import type { VisitorSessionResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

interface VisitorSessionTrendTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<VisitorSessionResponse>;
  focus?: "visitors" | "sessions";
}

export function VisitorSessionTrendTable({ context, state, focus }: VisitorSessionTrendTableProps) {
  return (
    <section
      className="card scroll-mt-6"
      id={focus ?? "visitors"}
      aria-labelledby="visitor-session-heading"
    >
      <h2 id="visitor-session-heading">
        {focus === "sessions"
          ? "Sessions"
          : focus === "visitors"
            ? "Visitors"
            : "Visitors and Sessions"}
      </h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <DisabledState context={context} label="Audience" />
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Audience" />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          context={context}
          message="No Phase 6 analytics data is available for this selection."
        />
      ) : (
        <Table className="data-table">
          <caption className="table-caption">Daily Visitor and Session metrics in UTC</caption>
          <thead>
            <tr>
              <th scope="col">UTC Date</th>
              {focus === undefined && <th scope="col">Page Views</th>}
              {focus !== "sessions" && <th scope="col">Unique Visitors</th>}
              {focus !== "visitors" && <th scope="col">Sessions</th>}
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((item) => (
              <tr key={item.day}>
                <td>{item.day}</td>
                {focus === undefined && <td>{item.page_views}</td>}
                {focus !== "sessions" && <td>{item.unique_visitors}</td>}
                {focus !== "visitors" && <td>{item.sessions}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
