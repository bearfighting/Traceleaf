import React from "react";

import { loadDashboardPhase6Report } from "../lib/dashboard-reports";

import { DimensionReportTable } from "./dimension-report-table";
import { FreshnessBanner } from "./freshness-banner";
import { OverviewCard } from "./overview-card";
import { ErrorState } from "./states/error-state";
import { VisitorSessionTrendTable } from "./visitor-session-trend-table";

import type { AnalyticsApiClient } from "../lib/analytics-api/client";
import type { DashboardOverviewContext } from "../lib/dashboard-overview";

interface Phase6DashboardSectionsProps {
  context: DashboardOverviewContext;
  client: AnalyticsApiClient;
  report: string;
}

export async function Phase6DashboardSections({
  context,
  client,
  report,
}: Phase6DashboardSectionsProps) {
  if (
    report !== "overview" &&
    report !== "visitors" &&
    report !== "sessions" &&
    report !== "dimensions"
  ) {
    return null;
  }

  const result = await loadDashboardPhase6Report(context, report, { client });

  if (result.kind === "audience" && report === "overview")
    return (
      <>
        <FreshnessBanner visitorState={result.state} />
        <section className="overview-grid" aria-label="Audience summary">
          {result.state.status === "success" ? (
            <>
              <OverviewCard
                context={context}
                label="Unique Visitors"
                pageViews={result.state.data.unique_visitors}
              />
              <OverviewCard
                context={context}
                label="Sessions"
                pageViews={result.state.data.sessions}
              />
            </>
          ) : result.state.status === "error" ? (
            <section className="card" aria-label="Audience summary error">
              <ErrorState context={context} message={result.state.error.message} />
            </section>
          ) : (
            <section className="card" aria-label="Audience summary unavailable">
              <p role="status">Audience analytics are not enabled for this site.</p>
            </section>
          )}
        </section>
      </>
    );

  return (
    <>
      {result.kind === "audience" && (
        <>
          <FreshnessBanner visitorState={result.state} />
          <VisitorSessionTrendTable
            context={context}
            state={result.state}
            focus={report === "visitors" || report === "sessions" ? report : undefined}
          />
        </>
      )}
      {result.kind === "dimension" && (
        <>
          <FreshnessBanner dimensionState={result.state} />
          <DimensionReportTable context={context} state={result.state} />
        </>
      )}
    </>
  );
}
