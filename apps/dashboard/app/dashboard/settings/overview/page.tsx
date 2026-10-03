import React from "react";

import { DashboardHeader, DashboardShell } from "../../../../components/dashboard-shell";
import { SettingsNavigation } from "../../../../components/settings-navigation";
import {
  SiteConnectionStatus,
  type PageViewEvidence,
} from "../../../../components/site-connection-status";
import {
  SiteDirectoryState,
  SiteSelectionState,
} from "../../../../components/site-directory-state";
import { selectDashboardSite, siteOptions } from "../../../../config/sites";
import { createAnalyticsApiClient } from "../../../../lib/analytics-api/client";
import { getAnalyticsApiUrl } from "../../../../lib/analytics-api/config";
import { AnalyticsApiClientError } from "../../../../lib/analytics-api/errors";
import { ANALYTICS_DIMENSIONS } from "../../../../lib/analytics-api/types";
import {
  getConfigurationEnvironment,
  loadSiteConfiguration,
} from "../../../../lib/configuration-api/server";
import {
  dashboardRoute,
  settingsRoute,
  type SettingsRouteContext,
} from "../../../../lib/settings-routes";
import { loadSiteDirectory } from "../../../../lib/site-management/client";

export const dynamic = "force-dynamic";

interface SettingsPageProps {
  searchParams: Promise<{
    site_id?: string | string[];
    from?: string | string[];
    to?: string | string[];
    dimension?: string | string[];
    definition_version?: string | string[];
    environment?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const requestedContext: SettingsRouteContext = {
    siteId: firstValue(params.site_id),
    environment: firstValue(params.environment),
    from: firstValue(params.from),
    to: firstValue(params.to),
    dimension: firstValue(params.dimension),
    definitionVersion: firstValue(params.definition_version),
  };
  const directory = await loadSiteDirectory();
  if (directory.kind !== "ready" || directory.sites.length === 0) {
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <SettingsStatusHeader context={requestedContext} />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Site settings</h1>
          <SiteDirectoryState result={directory} />
        </div>
      </main>
    );
  }

  const requestedSite = firstValue(params.site_id);
  const selection = selectDashboardSite(directory.sites, requestedSite);
  if (selection.kind !== "selected") {
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <SettingsStatusHeader context={requestedContext} />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Site settings</h1>
          <SiteSelectionState selection={selection} sites={directory.sites} />
        </div>
      </main>
    );
  }
  const siteId = selection.site.site_id;
  const environment = firstValue(params.environment)?.trim() || getConfigurationEnvironment();
  const requestedDimension = firstValue(params.dimension);
  const dimension = ANALYTICS_DIMENSIONS.find((value) => value === requestedDimension) ?? "browser";
  const dateRange = { from: firstValue(params.from) ?? "", to: firstValue(params.to) ?? "" };
  const definitionVersion = firstValue(params.definition_version);
  const routeContext = {
    siteId,
    environment: environment ?? undefined,
    from: dateRange.from,
    to: dateRange.to,
    dimension,
    definitionVersion,
  };
  const [configuration, analytics] = await Promise.all([
    environment
      ? loadSiteConfiguration(siteId, environment)
      : Promise.resolve({
          kind: "environment_unconfigured" as const,
          message: "DASHBOARD_DEFAULT_ENVIRONMENT is not configured on the Dashboard server.",
        }),
    loadPageViewEvidence(siteId),
  ]);

  return (
    <DashboardShell
      dateRange={dateRange}
      siteId={siteId}
      sites={siteOptions(directory.sites)}
      dimension={dimension}
      definitionVersion={definitionVersion}
      environment={environment ?? undefined}
      settingsMode
    >
      <SettingsNavigation
        site={selection.site}
        environment={environment ?? undefined}
        context={routeContext}
      />
      <SiteConnectionStatus
        site={selection.site}
        environment={environment ?? "not configured"}
        configuration={configuration}
        analytics={analytics}
      />
      <section className="card mb-6" aria-label="Site overview">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{selection.site.site_id}</p>
            <h2 className="m-0 text-xl font-semibold">
              {selection.site.display_name || selection.site.site_id}
            </h2>
            <p className="mb-0 mt-1 text-sm text-muted">
              {selection.site.website_url || "Website URL missing"}
            </p>
          </div>
          <div className="text-sm">
            <p className="m-0">Lifecycle: {selection.site.lifecycle_status}</p>
            <p className="m-0">Setup readiness: {selection.site.setup_status}</p>
            <p className="m-0">Environment: {environment ?? "not configured"}</p>
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}

function SettingsStatusHeader({ context }: { context: SettingsRouteContext }) {
  return (
    <DashboardHeader
      settingsMode
      analyticsHref={dashboardRoute(context)}
      settingsHref={settingsRoute("overview", context)}
    />
  );
}

async function loadPageViewEvidence(siteId: string): Promise<PageViewEvidence> {
  try {
    const result = await createAnalyticsApiClient({ baseUrl: getAnalyticsApiUrl() }).overview(
      siteId,
    );

    return { kind: "ready", pageViews: result.page_views };
  } catch (cause) {
    return {
      kind: "error",
      message:
        cause instanceof AnalyticsApiClientError
          ? cause.message
          : "Analytics service is unavailable. Try again later.",
    };
  }
}
