import React from "react";

import { selectDashboardSite, siteOptions } from "../config/sites";
import { ANALYTICS_DIMENSIONS } from "../lib/analytics-api/types";
import {
  loadSiteCapabilities,
  loadSiteConfiguration,
  getConfigurationEnvironment,
} from "../lib/configuration-api/server";
import { dashboardRoute, settingsRoute, type SettingsRouteContext } from "../lib/settings-routes";
import { loadSiteDirectory } from "../lib/site-management/client";

import { ConfigurationEditor } from "./configuration-editor";
import { DashboardHeader, DashboardShell } from "./dashboard-shell";
import { EnvironmentSelector } from "./environment-selector";
import { SettingsNavigation } from "./settings-navigation";
import { SiteDirectoryState, SiteSelectionState } from "./site-directory-state";

export async function SettingsTaskPage({
  section,
  searchParams,
}: {
  section: "capabilities" | "environments";
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
          settingsHref={settingsRoute(section, context)}
        />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">
            {section === "capabilities" ? "Capabilities" : "Environments & Origins"}
          </h1>
          <SiteDirectoryState result={directory} />
        </div>
      </main>
    );
  const selection = selectDashboardSite(directory.sites, first(params.site_id));
  if (selection.kind !== "selected")
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader
          settingsMode
          analyticsHref={dashboardRoute(context)}
          settingsHref={settingsRoute(section, context)}
        />
        <div className="dashboard-container py-8">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Settings</h1>
          <SiteSelectionState selection={selection} sites={directory.sites} />
        </div>
      </main>
    );
  const siteId = selection.site.site_id;
  const environment = first(params.environment)?.trim() || getConfigurationEnvironment();
  const routeContext = { ...context, siteId, environment };
  const requestedDimension = first(params.dimension);
  const dimension = ANALYTICS_DIMENSIONS.find((value) => value === requestedDimension) ?? "browser";
  const result =
    section === "capabilities"
      ? await loadSiteCapabilities(siteId)
      : environment
        ? await loadSiteConfiguration(siteId, environment)
        : {
            kind: "environment_unconfigured" as const,
            message: "Enter an Environment name to load its policy.",
          };

  return (
    <DashboardShell
      dateRange={{ from: first(params.from) ?? "", to: first(params.to) ?? "" }}
      siteId={siteId}
      sites={siteOptions(directory.sites)}
      dimension={dimension}
      definitionVersion={first(params.definition_version)}
      environment={environment}
      settingsSection={section}
      settingsMode
    >
      <SettingsNavigation
        site={selection.site}
        environment={section === "environments" ? environment : undefined}
        context={routeContext}
        section={section}
      />
      <h1 className="mb-6 text-3xl font-bold tracking-tight">
        {section === "capabilities" ? "Capabilities" : "Environments & Origins"}
      </h1>
      {section === "environments" && (
        <EnvironmentSelector
          value={environment ?? ""}
          siteId={siteId}
          from={first(params.from)}
          to={first(params.to)}
          dimension={first(params.dimension)}
        />
      )}
      {section === "environments" && result.kind === "environment_unconfigured" ? (
        <section className="card">
          <p>{result.message}</p>
          <a href={settingsRoute("capabilities", routeContext)}>Go to Capabilities</a>
        </section>
      ) : (
        <ConfigurationEditor
          siteId={siteId}
          environment={environment ?? ""}
          result={result}
          section={section}
        />
      )}
    </DashboardShell>
  );
}
