import React from "react";

import { DashboardSections } from "../../components/dashboard-sections";
import { DashboardHeader, DashboardShell } from "../../components/dashboard-shell";
import { SiteDirectoryState, SiteSelectionState } from "../../components/site-directory-state";
import { ErrorState } from "../../components/states/error-state";
import { selectDashboardSite, siteOptions } from "../../config/sites";
import { getAnalyticsReportCopy } from "../../lib/analytics-report-copy";
import { loadDefinitionRevisions } from "../../lib/dashboard-page-data";
import {
  defaultDashboardDateRange,
  parseDashboardQuery,
  type DashboardDateRange,
  type DashboardSearchParams,
} from "../../lib/query-params";
import { loadSiteDirectory } from "../../lib/site-management/client";

import type { Metadata } from "next";

interface DashboardPageProps {
  searchParams: Promise<DashboardSearchParams>;
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  return DashboardRouteContent({ searchParams, report: "overview" });
}

export async function DashboardRouteContent({
  searchParams,
  report,
}: DashboardPageProps & { report: string }) {
  const reportInfo = getAnalyticsReportCopy(report);
  const resolvedSearchParams = await searchParams;
  const environment = firstValue(resolvedSearchParams.environment);
  const directory = await loadSiteDirectory();
  if (directory.kind !== "ready" || directory.sites.length === 0) {
    return (
      <main className="dashboard-shell">
        <DashboardHeader />
        <div className="dashboard-content">
          <h1 className="page-title-compact">{reportInfo.title}</h1>
          <p className="page-description-compact">{reportInfo.description}</p>
          <SiteDirectoryState result={directory} />
        </div>
      </main>
    );
  }

  const requestedSite = firstValue(resolvedSearchParams.site_id);
  const selection = selectDashboardSite(directory.sites, requestedSite);
  const options = siteOptions(directory.sites);
  if (selection.kind === "unknown") {
    const displayedSite =
      directory.sites.find((site) => site.lifecycle_status === "active") ?? directory.sites[0];
    const dateRange = {
      from: firstValue(resolvedSearchParams.from) || defaultDashboardDateRange(new Date()).from,
      to: firstValue(resolvedSearchParams.to) || defaultDashboardDateRange(new Date()).to,
    };

    return (
      <DashboardShell
        report={report}
        dateRange={dateRange}
        siteId={displayedSite.site_id}
        sites={options}
        dimension="browser"
        environment={environment}
      >
        <section className="card" id="overview">
          <ErrorState
            context={{ siteId: selection.requestedSiteId, dateRange }}
            message={`Site ${selection.requestedSiteId} is not present in the Site Registry.`}
          />
        </section>
      </DashboardShell>
    );
  }
  if (selection.kind === "no_active_sites") {
    return (
      <main className="dashboard-shell">
        <DashboardHeader />
        <div className="dashboard-content">
          <h1 className="page-title-compact">{reportInfo.title}</h1>
          <p className="page-description-compact">{reportInfo.description}</p>
          <SiteSelectionState selection={selection} sites={directory.sites} />
        </div>
      </main>
    );
  }
  if (selection.kind === "no_sites") {
    return (
      <main className="dashboard-shell">
        <DashboardHeader />
        <div className="dashboard-content">
          <h1 className="page-title-compact">{reportInfo.title}</h1>
          <p className="page-description-compact">{reportInfo.description}</p>
          <section className="card">
            <ErrorState message="The Site Registry returned no selectable Sites." />
          </section>
        </div>
      </main>
    );
  }

  const query = parseDashboardQuery(
    resolvedSearchParams,
    selection.site.site_id,
    directory.sites.map((site) => site.site_id),
  );

  if (query.error) {
    const defaultDateRange = defaultDashboardDateRange(new Date());
    const displayedSite = selection.site.site_id;
    const displayedDateRange: DashboardDateRange = {
      from: firstValue(resolvedSearchParams.from) || defaultDateRange.from,
      to: firstValue(resolvedSearchParams.to) || defaultDateRange.to,
    };

    return (
      <DashboardShell
        report={report}
        dateRange={displayedDateRange}
        siteId={displayedSite}
        sites={options}
        dimension="browser"
        environment={environment}
      >
        <section className="card" id="overview">
          <ErrorState
            context={{ siteId: displayedSite, dateRange: displayedDateRange }}
            message={query.error.message}
          />
        </section>
      </DashboardShell>
    );
  }

  const definitionVersions = await loadDefinitionRevisions(query.params.siteId);

  return (
    <DashboardShell
      report={report}
      definitionVersions={definitionVersions}
      definitionVersion={query.params.definitionVersion}
      dateRange={query.params.dateRange}
      siteId={query.params.siteId}
      sites={options}
      dimension={query.params.dimension}
      environment={environment}
    >
      <DashboardSections
        report={report}
        environment={environment}
        from={query.params.dateRange.from}
        siteId={query.params.siteId}
        to={query.params.dateRange.to}
        dimension={query.params.dimension}
        definitionVersion={query.params.definitionVersion}
      />
    </DashboardShell>
  );
}
