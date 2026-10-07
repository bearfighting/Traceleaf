import React, { Suspense } from "react";

import { createAnalyticsApiClient } from "../../lib/analytics/analytics-api/client";
import { getAnalyticsApiUrl } from "../../lib/analytics/analytics-api/config";
import { AnalyticsApiClientError } from "../../lib/analytics/analytics-api/errors";
import { AudienceDimensionReportSections } from "../analytics/audience-dimension-report-sections";
import { ReportLoadingState } from "../analytics/report-loading-state";
import { TrafficAndOutcomeReportSections } from "../analytics/traffic-and-outcome-report-sections";

import { ErrorState } from "./states/error-state";
import { LoadingState } from "./states/loading-state";

import type { AnalyticsApiClient } from "../../lib/analytics/analytics-api/client";
import type { AnalyticsDimension } from "../../lib/analytics/analytics-api/types";

interface DashboardSectionsProps {
  siteId: string;
  from: string;
  to: string;
  dimension: AnalyticsDimension;
  definitionVersion?: string;
  report: string;
  environment?: string;
}

export function DashboardSections({
  siteId,
  from,
  to,
  dimension,
  definitionVersion,
  report,
  environment,
}: DashboardSectionsProps) {
  const context = { siteId, dateRange: { from, to }, dimension, definitionVersion, environment };
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
      <section className="card" aria-label={report}>
        <ErrorState context={context} message={error.message} />
      </section>
    );
  }

  return (
    <>
      <Suspense
        fallback={
          [
            "overview",
            "pages",
            "custom-events",
            "countries",
            "web-vitals",
            "conversions",
            "funnels",
          ].includes(report) ? (
            <section className="card" aria-label={`${report} loading`}>
              {report === "overview" ? (
                <LoadingState context={context} />
              ) : (
                <p role="status">Loading {report.replaceAll("-", " ")}...</p>
              )}
            </section>
          ) : null
        }
      >
        <TrafficAndOutcomeReportSections
          context={context}
          client={client}
          report={report}
          environment={environment}
        />
      </Suspense>
      <Suspense
        fallback={
          ["overview", "visitors", "sessions", "dimensions"].includes(report) ? (
            <ReportLoadingState
              heading={
                report === "overview"
                  ? "Audience summary"
                  : report === "dimensions"
                    ? "Dimensions"
                    : report === "sessions"
                      ? "Sessions"
                      : "Visitors"
              }
            />
          ) : null
        }
      >
        <AudienceDimensionReportSections context={context} client={client} report={report} />
      </Suspense>
    </>
  );
}
