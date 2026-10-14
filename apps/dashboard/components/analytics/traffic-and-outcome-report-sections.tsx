import React from "react";

import { loadDashboardOverview } from "../../lib/analytics/dashboard-overview";
import { loadTrafficAndOutcomeReport } from "../../lib/analytics/dashboard-reports";
import { loadSiteDefinitions } from "../../lib/settings/configuration-api/server";
import { ErrorState } from "../shared/states/error-state";

import { ConversionFunnelTables } from "./conversion-funnel-tables";
import { EventReportTable } from "./event-report-table";
import { GeoCountryTable } from "./geo-country-table";
import { OverviewCard } from "./overview-card";
import { OverviewPageViewsSection } from "./overview-page-views-section";
import { TimelineTable } from "./timeline-table";
import { TopPagesTable } from "./top-pages-table";
import { WebVitalsTable } from "./web-vitals-table";

import type { AnalyticsApiClient } from "../../lib/analytics/analytics-api/client";
import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";

interface TrafficAndOutcomeReportSectionsProps {
  context: DashboardOverviewContext;
  client: AnalyticsApiClient;
  report: string;
  environment?: string;
}

export async function TrafficAndOutcomeReportSections({
  context,
  client,
  report,
  environment,
}: TrafficAndOutcomeReportSectionsProps) {
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
              metric="page_views"
              value={overview.data.overview.page_views}
            />
            <OverviewCard
              context={context}
              label="Selected range Page Views"
              metric="page_views"
              value={overview.data.rangeOverview.page_views}
            />
          </section>
        )}
        {overview.status === "success" && (
          <OverviewPageViewsSection context={context} state={overview.data.timeline} />
        )}
        <section className="card" aria-label="Detailed reports">
          <h2>Explore reports</h2>
          <nav aria-label="Explore reports" className="report-links">
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
                className="report-link"
                href={`/dashboard/${path}?${params.toString()}`}
                key={path}
              >
                {path.replaceAll("-", " ")}
              </a>
            ))}
          </nav>
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

  const [reports, definitionsResult] = await Promise.all([
    loadTrafficAndOutcomeReport(context, report, client),
    report === "conversions" || report === "funnels"
      ? loadSiteDefinitions(context.siteId)
      : Promise.resolve(undefined),
  ]);

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
          definitions={
            definitionsResult?.kind === "ready" &&
            reports.conversions.status === "success" &&
            definitionsResult.definitions?.definition_version ===
              reports.conversions.data.definition_version
              ? definitionsResult.definitions
              : null
          }
          showConversions
          showFunnels={false}
        />
      )}
      {report === "funnels" && reports.funnels && (
        <ConversionFunnelTables
          context={context}
          funnels={reports.funnels}
          definitions={
            definitionsResult?.kind === "ready" &&
            reports.funnels.status === "success" &&
            definitionsResult.definitions?.definition_version ===
              reports.funnels.data.definition_version
              ? definitionsResult.definitions
              : null
          }
          showConversions={false}
          showFunnels
        />
      )}
    </>
  );
}
