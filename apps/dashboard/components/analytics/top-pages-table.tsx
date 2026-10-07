import React from "react";

import { DisabledState } from "../shared/states/disabled-state";
import { EmptyState } from "../shared/states/empty-state";
import { ErrorState } from "../shared/states/error-state";
import { UnavailableState } from "../shared/states/unavailable-state";
import { Table } from "../ui/index";

import type { PagesResponse } from "../../lib/analytics/analytics-api/types";
import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";
import type { DashboardReportState } from "../../lib/analytics/dashboard-reports";

interface TopPagesTableProps {
  context: DashboardOverviewContext;
  state: DashboardReportState<PagesResponse>;
}

export function TopPagesTable({ context, state }: TopPagesTableProps) {
  return (
    <section className="card report-card" id="top-pages" aria-labelledby="top-pages-heading">
      <h2 id="top-pages-heading">Top Pages</h2>
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <DisabledState context={context} label="Page View" />
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Page View" />
      ) : state.data.items.length === 0 ? (
        <EmptyState context={context} />
      ) : (
        <Table className="data-table">
          <caption className="table-caption">Page Views by path</caption>
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">Page Views</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((item) => (
              <tr key={item.path}>
                <td>
                  <code>{item.path}</code>
                </td>
                <td>{item.page_views}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
