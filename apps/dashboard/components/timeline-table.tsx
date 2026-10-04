import React from "react";

import { settingsRoute } from "../lib/settings-routes";

import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";
import { UnavailableState } from "./states/unavailable-state";
import { Table } from "./ui";

import type { TimelineResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

interface TimelineTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<TimelineResponse>;
}

export function TimelineTable({ context, state }: TimelineTableProps) {
  return (
    <section className="card report-card" id="timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">Timeline</h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <p role="status">
          Page View analytics are not enabled for Site {context.siteId} ({context.dateRange.from} to{" "}
          {context.dateRange.to} UTC).{" "}
          <a
            href={settingsRoute("capabilities", {
              siteId: context.siteId,
              environment: context.environment,
              from: context.dateRange.from,
              to: context.dateRange.to,
              dimension: context.dimension,
              definitionVersion: context.definitionVersion,
            })}
          >
            Review capabilities
          </a>
        </p>
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Page View" />
      ) : state.data.items.length === 0 ? (
        <EmptyState context={context} />
      ) : (
        <Table className="data-table">
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
        </Table>
      )}
    </section>
  );
}
