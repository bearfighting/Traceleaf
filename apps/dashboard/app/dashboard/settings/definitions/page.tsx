import Link from "next/link";
import React from "react";

import { DashboardHeader, DashboardShell } from "../../../../components/dashboard-shell";
import { DefinitionEditor } from "../../../../components/definition-editor";
import { SettingsNavigation } from "../../../../components/settings-navigation";
import {
  SiteDirectoryState,
  SiteSelectionState,
} from "../../../../components/site-directory-state";
import { selectDashboardSite, siteOptions } from "../../../../config/sites";
import { ANALYTICS_DIMENSIONS } from "../../../../lib/analytics-api/types";
import {
  getConfigurationEnvironment,
  loadSiteDefinitions,
} from "../../../../lib/configuration-api/server";
import { loadDefinitionRevisionHistory } from "../../../../lib/dashboard-page-data";
import {
  analyticsReportRoute,
  dashboardRoute,
  settingsRoute,
  type SettingsRouteContext,
} from "../../../../lib/settings-routes";
import { loadSiteDirectory } from "../../../../lib/site-management/client";

export const dynamic = "force-dynamic";

export default async function DefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const context: SettingsRouteContext = {
    siteId: first(params.site_id),
    environment: first(params.environment),
    from: first(params.from),
    to: first(params.to),
    dimension: first(params.dimension),
    definitionVersion: first(params.definition_version),
  };
  const directory = await loadSiteDirectory();
  if (directory.kind !== "ready" || directory.sites.length === 0)
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader
          settingsMode
          analyticsHref={dashboardRoute(context)}
          settingsHref={settingsRoute("definitions", context)}
        />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Definitions</h1>
          <SiteDirectoryState result={directory} />
        </div>
      </main>
    );
  const selection = selectDashboardSite(directory.sites, context.siteId);
  if (selection.kind !== "selected")
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader
          settingsMode
          analyticsHref={dashboardRoute(context)}
          settingsHref={settingsRoute("definitions", context)}
        />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Definitions</h1>
          <SiteSelectionState selection={selection} sites={directory.sites} />
        </div>
      </main>
    );
  const siteId = selection.site.site_id;
  const environment = first(params.environment)?.trim() || getConfigurationEnvironment();
  const routeContext = { ...context, siteId, environment: environment ?? undefined };
  const requestedDimension = first(params.dimension);
  const dimension = ANALYTICS_DIMENSIONS.find((value) => value === requestedDimension) ?? "browser";
  const [definitions, history] = await Promise.all([
    loadSiteDefinitions(siteId),
    loadDefinitionRevisionHistory(siteId),
  ]);

  return (
    <DashboardShell
      dateRange={{ from: first(params.from) ?? "", to: first(params.to) ?? "" }}
      siteId={siteId}
      sites={siteOptions(directory.sites)}
      dimension={dimension}
      definitionVersion={context.definitionVersion}
      environment={environment ?? undefined}
      settingsSection="definitions"
      settingsMode
    >
      <SettingsNavigation site={selection.site} context={routeContext} section="definitions" />
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Definitions</h1>
      <p className="mb-6 text-sm text-muted">
        {selection.site.display_name || siteId} · {siteId}
      </p>
      <section className="card mb-6" aria-label="Definition revision history">
        <h2 className="mt-0 text-lg font-semibold">Revision history</h2>
        {history.kind === "error" ? (
          <p role="alert">{history.message}</p>
        ) : history.revisions.length === 0 ? (
          <p>No stored definition revisions yet.</p>
        ) : (
          <>
            <p>Current revision: {history.currentVersion ?? "Not available"}</p>
            <ol>
              {history.revisions.map((item) => (
                <li key={item.version}>
                  <Link
                    href={analyticsReportRoute("conversions", {
                      ...routeContext,
                      definitionVersion: item.version,
                    })}
                  >
                    Revision {item.revision} · {item.version}
                  </Link>
                  {" · Effective "}
                  {item.effectiveAt
                    ? new Date(item.effectiveAt).toLocaleString("en-CA", {
                        timeZone: "UTC",
                        timeZoneName: "short",
                      })
                    : "imported baseline"}
                </li>
              ))}
            </ol>
            <p className="mb-0 text-sm text-muted">
              Select a stored revision in the analytics date and revision controls to view its
              available historical report.
            </p>
          </>
        )}
      </section>
      <section className="card mb-6" aria-label="Definition change impact">
        <h2 className="mt-0 text-lg font-semibold">When changes take effect</h2>
        <p className="mb-0">
          Definition updates affect events processed from their effective time onward. Existing
          facts are not recalculated automatically. Historical recalculation must use the explicit
          operations workflow.
        </p>
      </section>
      <DefinitionEditor siteId={siteId} result={definitions} />
    </DashboardShell>
  );
}
