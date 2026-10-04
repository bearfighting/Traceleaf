import React from "react";

import { DisabledState } from "./states/disabled-state";
import { EmptyState } from "./states/empty-state";
import { ErrorState } from "./states/error-state";
import { UnavailableState } from "./states/unavailable-state";
import { Table } from "./ui";

import type { GeoCountryResponse } from "../lib/analytics-api/types";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";
import type { DashboardReportState } from "../lib/dashboard-reports";

export function GeoCountryTable({
  context,
  state,
}: {
  context: DashboardOverviewContext;
  state: DashboardReportState<GeoCountryResponse>;
}) {
  return (
    <section className="card report-card" id="countries" aria-labelledby="geo-country-heading">
      <h2 id="geo-country-heading">Countries</h2>
      {state.status === "success" && state.data.freshness_status !== "current" && (
        <p
          className={`freshness-${state.data.freshness_status}`}
          role={state.data.freshness_status === "failed" ? "alert" : "status"}
        >
          Geo report data freshness: {state.data.freshness_status}
        </p>
      )}
      {state.status === "success" && state.data.providers.includes("db-ip") && (
        <p className="table-caption">
          IP geolocation by <a href="https://db-ip.com">DB-IP</a>
        </p>
      )}
      {state.status === "success" &&
        (state.data.coverage_from === null ||
          context.dateRange.from < state.data.coverage_from) && (
          <p role="status">
            {state.data.coverage_from === null
              ? "Geo coverage start is unknown; historical country data may be incomplete."
              : `Geo country data is available from ${state.data.coverage_from}. Earlier Page Views are not included.`}
          </p>
        )}
      {state.status === "error" ? (
        <ErrorState context={context} message={state.error.message} />
      ) : state.status === "disabled" ? (
        <DisabledState context={context} label="Geo country" />
      ) : state.status === "unavailable" ? (
        <UnavailableState context={context} label="Geo country" />
      ) : state.data.items.length === 0 ? (
        <EmptyState context={context} />
      ) : (
        <Table className="data-table">
          <caption className="table-caption">Page Views by country</caption>
          <thead>
            <tr>
              <th scope="col">Country code</th>
              <th scope="col">Page Views</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((item) => (
              <tr key={item.country_code}>
                <td>{item.country_code === "unknown" ? "Unknown" : item.country_code}</td>
                <td>{item.page_views}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
