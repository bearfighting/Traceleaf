import React from "react";

import {
  DEFINITION_REPORT_ITEM_LIMIT,
  type DashboardDefinitionReportState,
} from "../../lib/analytics/dashboard-reports";
import { settingsRoute } from "../../lib/settings/settings-routes";
import { ErrorState } from "../shared/states/error-state";
import { UnavailableState } from "../shared/states/unavailable-state";
import { Table } from "../ui/index";

import { ConversionRateCharts, FunnelStepCharts } from "./conversion-funnel-chart";
import {
  conversionChartSeries,
  formatConversionRate,
  funnelChartSeries,
} from "./conversion-funnel-chart-data";

import type {
  ConversionReportResponse,
  FunnelReportResponse,
} from "../../lib/analytics/analytics-api/types";
import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";
import type { DefinitionSetResponse } from "../../lib/settings/configuration-api/types";

export function ConversionFunnelTables({
  context,
  conversions,
  funnels,
  definitions,
  showConversions = true,
  showFunnels = true,
}: {
  context: DashboardOverviewContext;
  conversions?: DashboardDefinitionReportState<ConversionReportResponse>;
  funnels?: DashboardDefinitionReportState<FunnelReportResponse>;
  definitions?: DefinitionSetResponse | null;
  showConversions?: boolean;
  showFunnels?: boolean;
}) {
  return (
    <>
      {showConversions && conversions && (
        <>
          <section
            className="card report-card"
            id="conversions"
            aria-labelledby="conversions-heading"
          >
            <h2 id="conversions-heading">Conversions</h2>
            {conversions.status === "success" && (
              <p>Definition revision: {conversions.data.definition_version}</p>
            )}
            {conversions.status === "error" ? (
              <ErrorState context={context} message={conversions.error.message} />
            ) : conversions.status === "disabled" ? (
              <UnavailableLink context={context} section="capabilities" label="Conversions" />
            ) : conversions.status === "unavailable" ? (
              <UnavailableState context={context} label="Conversions" />
            ) : conversions.status === "missing_definitions" ? (
              <MissingDefinitions context={context} />
            ) : (
              <>
                {conversions.data.items.length === 0 ? (
                  <p role="status">No conversion data is available for this selection.</p>
                ) : (
                  <>
                    <p className="metric">{conversions.data.total}</p>
                    {conversions.data.items.length >= DEFINITION_REPORT_ITEM_LIMIT && (
                      <p role="status">
                        Showing up to {DEFINITION_REPORT_ITEM_LIMIT} conversion report rows; this
                        result may be truncated.
                      </p>
                    )}
                    <ConversionRateCharts
                      series={conversionChartSeries(conversions.data, definitions)}
                    />
                    <Table className="data-table">
                      <caption className="table-caption">
                        Conversion events and session rate by UTC date
                      </caption>
                      <thead>
                        <tr>
                          <th>Conversion</th>
                          <th>Date</th>
                          <th>Events</th>
                          <th>Converted sessions</th>
                          <th>Eligible sessions</th>
                          <th>Session rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conversions.data.items.map((item) => (
                          <tr key={`${item.definition_id}:${item.day}`}>
                            <td>{item.definition_id}</td>
                            <td>{item.day}</td>
                            <td>{item.event_count}</td>
                            <td>{item.converted_sessions}</td>
                            <td>{item.eligible_sessions}</td>
                            <td>{formatConversionRate(item)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </>
                )}
                <p className={`freshness-${conversions.data.freshness_status}`} role="status">
                  Data freshness: {conversions.data.freshness_status}
                </p>
              </>
            )}
          </section>
        </>
      )}
      {showFunnels && funnels && (
        <>
          <section className="card report-card" id="funnels" aria-labelledby="funnels-heading">
            <h2 id="funnels-heading">Funnels</h2>
            {funnels.status === "success" && (
              <p>Definition revision: {funnels.data.definition_version}</p>
            )}
            {funnels.status === "error" ? (
              <ErrorState context={context} message={funnels.error.message} />
            ) : funnels.status === "disabled" ? (
              <UnavailableLink context={context} section="capabilities" label="Funnels" />
            ) : funnels.status === "unavailable" ? (
              <UnavailableState context={context} label="Funnels" />
            ) : funnels.status === "missing_definitions" ? (
              <MissingDefinitions context={context} />
            ) : (
              <>
                {funnels.data.items.length === 0 ? (
                  <p role="status">No funnel data is available for this selection.</p>
                ) : (
                  <>
                    <p className="metric">{funnels.data.total}</p>
                    {funnels.data.items.length >= DEFINITION_REPORT_ITEM_LIMIT && (
                      <p role="status">
                        Showing up to {DEFINITION_REPORT_ITEM_LIMIT} funnel report rows; this result
                        may be truncated.
                      </p>
                    )}
                    <FunnelStepCharts series={funnelChartSeries(funnels.data, definitions)} />
                    <Table className="data-table">
                      <caption className="table-caption">
                        Sessions reaching each funnel step by first-step cohort
                      </caption>
                      <thead>
                        <tr>
                          <th>Funnel</th>
                          <th>Cohort date</th>
                          <th>Step</th>
                          <th>Sessions</th>
                          <th>Rate from previous step</th>
                        </tr>
                      </thead>
                      <tbody>
                        {funnels.data.items.map((item) => (
                          <tr key={`${item.definition_id}:${item.day}:${item.step_index}`}>
                            <td>{item.definition_id}</td>
                            <td>{item.day}</td>
                            <td>{item.step_index + 1}</td>
                            <td>{item.sessions}</td>
                            <td>{(item.conversion_rate * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </>
                )}
                <p className={`freshness-${funnels.data.freshness_status}`} role="status">
                  Data freshness: {funnels.data.freshness_status}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

function MissingDefinitions({ context }: { context: DashboardOverviewContext }) {
  return (
    <p role="status">
      No definition revisions are configured for Site {context.siteId} ({context.dateRange.from} to{" "}
      {context.dateRange.to} UTC).{" "}
      <a
        href={settingsRoute("definitions", {
          siteId: context.siteId,
          environment: context.environment,
          from: context.dateRange.from,
          to: context.dateRange.to,
          definitionVersion: context.definitionVersion,
        })}
      >
        Configure definitions
      </a>
    </p>
  );
}

function UnavailableLink({
  context,
  section,
  label,
}: {
  context: DashboardOverviewContext;
  section: "capabilities";
  label: string;
}) {
  return (
    <p role="status">
      {label} analytics are not enabled for Site {context.siteId} ({context.dateRange.from} to{" "}
      {context.dateRange.to} UTC).{" "}
      <a
        href={settingsRoute(section, {
          siteId: context.siteId,
          environment: context.environment,
          from: context.dateRange.from,
          to: context.dateRange.to,
          definitionVersion: context.definitionVersion,
        })}
      >
        Review capabilities
      </a>
    </p>
  );
}
