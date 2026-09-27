import React from "react";

import { DashboardSections } from "../../components/dashboard-sections";
import { DashboardShell } from "../../components/dashboard-shell";
import { ErrorState } from "../../components/states/error-state";
import { getDashboardSiteConfig } from "../../config/sites";
import { loadDefinitionRevisions } from "../../lib/dashboard-page-data";
import {
  defaultDashboardDateRange,
  parseDashboardQuery,
  type DashboardDateRange,
  type DashboardSearchParams,
} from "../../lib/query-params";

interface DashboardPageProps {
  searchParams: Promise<DashboardSearchParams>;
}

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const siteConfig = getDashboardSiteConfig();

  if (siteConfig.error || !siteConfig.config) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <p className="eyebrow">Web Analytics</p>
          <h1>Dashboard configuration</h1>
        </header>
        <section className="card">
          <ErrorState message={`Dashboard site configuration is invalid: ${siteConfig.error}.`} />
        </section>
      </main>
    );
  }

  const resolvedSearchParams = await searchParams;
  const query = parseDashboardQuery(
    resolvedSearchParams,
    siteConfig.config.defaultSite,
    siteConfig.config.sites,
  );

  if (query.error) {
    const requestedSite = firstValue(resolvedSearchParams.site_id) || siteConfig.config.defaultSite;
    const defaultDateRange = defaultDashboardDateRange(new Date());
    const displayedSite = siteConfig.config.sites.includes(requestedSite)
      ? requestedSite
      : siteConfig.config.defaultSite;
    const displayedDateRange: DashboardDateRange = {
      from: firstValue(resolvedSearchParams.from) || defaultDateRange.from,
      to: firstValue(resolvedSearchParams.to) || defaultDateRange.to,
    };

    return (
      <DashboardShell
        dateRange={displayedDateRange}
        siteId={displayedSite}
        sites={siteConfig.config.sites}
        dimension="browser"
      >
        <section className="card">
          <ErrorState
            context={{ siteId: requestedSite, dateRange: displayedDateRange }}
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
      sites={siteConfig.config.sites}
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
