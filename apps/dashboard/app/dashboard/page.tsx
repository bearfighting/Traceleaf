import React from "react";

import { DashboardSections } from "../../components/dashboard-sections";
import { DashboardHeader, DashboardShell } from "../../components/dashboard-shell";
import { SiteDirectoryState, SiteSelectionState } from "../../components/site-directory-state";
import { ErrorState } from "../../components/states/error-state";
import { selectDashboardSite, siteOptions } from "../../config/sites";
import { loadDefinitionRevisions } from "../../lib/dashboard-page-data";
import {
  defaultDashboardDateRange,
  parseDashboardQuery,
  type DashboardDateRange,
  type DashboardSearchParams,
} from "../../lib/query-params";
import { loadSiteDirectory } from "../../lib/site-management/client";

interface DashboardPageProps {
  searchParams: Promise<DashboardSearchParams>;
}

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const directory = await loadSiteDirectory();
  if (directory.kind !== "ready" || directory.sites.length === 0) {
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Analytics</h1>
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
        dateRange={dateRange}
        siteId={displayedSite.site_id}
        sites={options}
        dimension="browser"
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
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Analytics</h1>
          <SiteSelectionState selection={selection} sites={directory.sites} />
        </div>
      </main>
    );
  }
  if (selection.kind === "no_sites") {
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Analytics</h1>
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
        dateRange={displayedDateRange}
        siteId={displayedSite}
        sites={options}
        dimension="browser"
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
      definitionVersions={definitionVersions}
      definitionVersion={query.params.definitionVersion}
      dateRange={query.params.dateRange}
      siteId={query.params.siteId}
      sites={options}
      dimension={query.params.dimension}
    >
      <DashboardSections
        from={query.params.dateRange.from}
        siteId={query.params.siteId}
        to={query.params.dateRange.to}
        dimension={query.params.dimension}
        definitionVersion={query.params.definitionVersion}
      />
    </DashboardShell>
  );
}
