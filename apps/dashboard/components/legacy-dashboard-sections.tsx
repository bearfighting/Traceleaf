import React from "react";

import { loadDashboardOverview } from "../lib/dashboard-overview";
import { loadDashboardLegacyReport } from "../lib/dashboard-reports";

import { ConversionFunnelTables } from "./conversion-funnel-tables";
import { EventReportTable } from "./event-report-table";
import { GeoCountryTable } from "./geo-country-table";
import { OverviewCard } from "./overview-card";
import { ErrorState } from "./states/error-state";
import { TimelineTable } from "./timeline-table";
import { TopPagesTable } from "./top-pages-table";
import { WebVitalsTable } from "./web-vitals-table";

import type { AnalyticsApiClient } from "../lib/analytics-api/client";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";

interface LegacyDashboardSectionsProps {
  context: DashboardOverviewContext;
  client: AnalyticsApiClient;
  report: string;
  environment?: string;
}

export async function LegacyDashboardSections({
  context,
  client,
  report,
  environment,
}: LegacyDashboardSectionsProps) {
  if (report === "overview") {
    const overview = await loadDashboardOverview(context, { client });
    const params = new URLSearchParams({
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
    });
    if (context.dimension) params.set("dimension", context.dimension);
    if (context.definitionVersion) params.set("definition_version", context.definitionVersion);
    if (environment) params.set("environment", environment);

    return (
      <>
        {overview.status === "error" ? (
          <section className="card" id="overview" aria-label="Overview">
            <h2>Overview</h2>
            <ErrorState context={context} message={overview.error.message} />
          </section>
        ) : (
          <section className="overview-grid" id="overview" aria-label="Overview">
            <OverviewCard
              context={context}
              label="Site total Page Views"
              pageViews={overview.data.overview.page_views}
            />
            <OverviewCard
              context={context}
              label="Selected range Page Views"
              pageViews={overview.data.rangeOverview.page_views}
            />
          </section>
        )}
        <section className="card" aria-label="Detailed reports">
          <h2>Explore reports</h2>
          <div className="flex flex-wrap gap-3">
            {[
              "pages",
              "dimensions",
              "visitors",
              "sessions",
              "custom-events",
              "web-vitals",
              "countries",
              "conversions",
              "funnels",
            ].map((path) => (
              <a
                className="button button-secondary"
                href={`/dashboard/${path}?${params.toString()}`}
                key={path}
              >
                {path.replaceAll("-", " ")}
              </a>
            ))}
          </div>
        </section>
      </>
    );
  }

  if (
    report !== "pages" &&
    report !== "custom-events" &&
    report !== "countries" &&
    report !== "web-vitals" &&
    report !== "conversions" &&
    report !== "funnels"
  ) {
    return null;
  }

  const reports = await loadDashboardLegacyReport(context, report, client);

  return (
    <>
      {report === "pages" && reports.timeline && reports.pages && (
        <>
          <TimelineTable context={context} state={reports.timeline} />
          <TopPagesTable context={context} state={reports.pages} />
        </>
      )}
      {report === "custom-events" && reports.events && (
        <EventReportTable context={context} state={reports.events} />
      )}
      {report === "countries" && reports.geoCountries && (
        <GeoCountryTable context={context} state={reports.geoCountries} />
      )}
      {report === "web-vitals" && reports.webVitals && (
        <WebVitalsTable context={context} state={reports.webVitals} />
      )}
      {report === "conversions" && reports.conversions && (
        <ConversionFunnelTables
          context={context}
          conversions={reports.conversions}
          showConversions
          showFunnels={false}
        />
      )}
      {report === "funnels" && reports.funnels && (
        <ConversionFunnelTables
          context={context}
          funnels={reports.funnels}
          showConversions={false}
          showFunnels
        />
      )}
    </>
  );
}
