import React, { Suspense } from "react";

import { createAnalyticsApiClient } from "../lib/analytics-api/client";
import { getAnalyticsApiUrl } from "../lib/analytics-api/config";
import { AnalyticsApiClientError } from "../lib/analytics-api/errors";

import { ConversionFunnelTables } from "./conversion-funnel-tables";
import { EventReportTable } from "./event-report-table";
import { GeoCountryTable } from "./geo-country-table";
import { LegacyDashboardSections } from "./legacy-dashboard-sections";
import { Phase6DashboardSections } from "./phase6-dashboard-sections";
import { Phase6LoadingState } from "./phase6-loading-state";
import { ErrorState } from "./states/error-state";
import { LoadingState } from "./states/loading-state";
import { WebVitalsTable } from "./web-vitals-table";

import type { AnalyticsApiClient } from "../lib/analytics-api/client";
import type { AnalyticsDimension } from "../lib/analytics-api/types";

interface DashboardSectionsProps {
  siteId: string;
  from: string;
  to: string;
  dimension: AnalyticsDimension;
  definitionVersion?: string;
}

export function DashboardSections({
  siteId,
  from,
  to,
  dimension,
  definitionVersion,
}: DashboardSectionsProps) {
  const context = { siteId, dateRange: { from, to }, dimension, definitionVersion };
  let client: AnalyticsApiClient;

  try {
    client = createAnalyticsApiClient({ baseUrl: getAnalyticsApiUrl() });
  } catch (cause) {
    const error =
      cause instanceof AnalyticsApiClientError
        ? cause
        : new AnalyticsApiClientError("Dashboard data could not be loaded.", {
            kind: "config",
            cause,
          });

    return (
      <>
        <section className="card" aria-label="Overview">
          <h2>Overview</h2>
          <ErrorState context={context} message={error.message} />
        </section>
        <EventReportTable context={context} state={{ status: "error", error }} />
        <GeoCountryTable context={context} state={{ status: "error", error }} />
        <WebVitalsTable context={context} state={{ status: "error", error }} />
        <ConversionFunnelTables
          context={context}
          conversions={{ status: "error", error }}
          funnels={{ status: "error", error }}
        />
        <section className="card" aria-label="Phase 6 analytics">
          <ErrorState context={context} message={error.message} />
        </section>
      </>
    );
  }

  return (
    <>
      <Suspense
        fallback={
          <>
            <section className="card" aria-label="Overview">
              <LoadingState context={context} />
            </section>
            <section className="card" aria-label="Custom Events">
              <h2>Custom Events</h2>
              <p role="status">Loading custom events...</p>
            </section>
            <section className="card" aria-label="Geo countries">
              <h2>Countries</h2>
              <p role="status">Loading country data...</p>
            </section>
            <section className="card" aria-label="Web Vitals">
              <h2>Web Vitals</h2>
              <p role="status">Loading Web Vitals...</p>
            </section>
            <section className="card" aria-label="Conversions">
              <h2>Conversions</h2>
              <p role="status">Loading conversions...</p>
            </section>
            <section className="card" aria-label="Funnels">
              <h2>Funnels</h2>
              <p role="status">Loading funnels...</p>
            </section>
          </>
        }
      >
        <LegacyDashboardSections context={context} client={client} />
      </Suspense>
      <Suspense
        fallback={
          <>
            <Phase6LoadingState heading="Visitors and Sessions" />
            <Phase6LoadingState heading="Dimension Report" />
          </>
        }
      >
        <Phase6DashboardSections context={context} client={client} />
      </Suspense>
    </>
  );
}
