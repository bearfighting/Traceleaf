import React from "react";

import { DisabledState } from "../shared/states/disabled-state";
import { EmptyState } from "../shared/states/empty-state";
import { ErrorState } from "../shared/states/error-state";
import { UnavailableState } from "../shared/states/unavailable-state";
import { Table } from "../ui/index";

import type { EventsResponse } from "../../lib/analytics/analytics-api/types";
import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";
import type { DashboardReportState } from "../../lib/analytics/dashboard-reports";

export function EventReportTable({
  context,
  state,
}: {
  context: DashboardOverviewContext;
  state: DashboardReportState<EventsResponse>;
}) {
  return (
    <section className="card report-card" id="custom-events" aria-labelledby="events-heading">
      <h2 id="events-heading">Custom Events</h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <DisabledState context={context} label="Custom Events" />
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Custom Events" />
      ) : state.data.items.length === 0 ? (
        <EmptyState context={context} />
      ) : (
        <>
          <p className="metric" data-events={state.data.total}>
            {state.data.total}
          </p>
          <Table className="data-table">
            <caption className="table-caption">Custom Event counts by UTC date</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Date</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {state.data.items.map((item) => (
                <tr key={`${item.event_name}:${item.day}`}>
                  <td>{item.event_name}</td>
                  <td>{item.day}</td>
                  <td>{item.event_count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </section>
  );
}
