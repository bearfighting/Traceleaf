import React from "react";

import { DisabledState } from "../shared/states/disabled-state";
import { EmptyState } from "../shared/states/empty-state";
import { ErrorState } from "../shared/states/error-state";
import { UnavailableState } from "../shared/states/unavailable-state";
import { Table } from "../ui/index";

import { OverviewCard } from "./overview-card";
import { VisitorSessionTrendChart } from "./visitor-session-trend-chart";

import type { VisitorSessionResponse } from "../../lib/analytics/analytics-api/types";
import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";
import type { DashboardReportState } from "../../lib/analytics/dashboard-reports";

interface VisitorSessionTrendTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<VisitorSessionResponse>;
  focus?: "visitors" | "sessions";
}

export function VisitorSessionTrendTable({ context, state, focus }: VisitorSessionTrendTableProps) {
  const visibleItems =
    state.status === "success"
      ? focus
        ? state.data.items
        : state.data.items.filter(
            (item) => item.page_views > 0 || item.unique_visitors > 0 || item.sessions > 0,
          )
      : [];

  return (
    <section
      className="card report-card"
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
      ) : visibleItems.length === 0 ? (
        <EmptyState
          context={context}
          message="No analytics data is available for this selection."
        />
      ) : (
        <>
          {focus && (
            <div className="overview-grid mb-4">
              <OverviewCard
                context={context}
                label={
                  focus === "visitors"
                    ? "Selected range Unique Visitors"
                    : "Selected range Sessions"
                }
                metric={focus === "visitors" ? "unique_visitors" : "sessions"}
                value={focus === "visitors" ? state.data.unique_visitors : state.data.sessions}
              />
            </div>
          )}
          {focus && (
            <>
              <p className="mb-3 text-sm text-muted">
                {focus === "visitors"
                  ? "Daily unique visitors are not additive to the selected range total."
                  : "Daily session activity in UTC."}
              </p>
              <VisitorSessionTrendChart items={visibleItems} focus={focus} />
            </>
          )}
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
              {visibleItems.map((item) => (
                <tr key={item.day}>
                  <td>{item.day}</td>
                  {focus === undefined && <td>{item.page_views}</td>}
                  {focus !== "sessions" && <td>{item.unique_visitors}</td>}
                  {focus !== "visitors" && <td>{item.sessions}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </section>
  );
}
