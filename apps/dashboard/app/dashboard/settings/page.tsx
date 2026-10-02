import React from "react";

import { ConfigurationEditor } from "../../../components/configuration-editor";
import { DashboardHeader, DashboardShell } from "../../../components/dashboard-shell";
import { DefinitionEditor } from "../../../components/definition-editor";
import { ErrorState } from "../../../components/states/error-state";
import { getDashboardSiteConfig } from "../../../config/sites";
import { ANALYTICS_DIMENSIONS } from "../../../lib/analytics-api/types";
import {
  getConfigurationEnvironment,
  loadSiteConfiguration,
  loadSiteDefinitions,
} from "../../../lib/configuration-api/server";

export const dynamic = "force-dynamic";

interface SettingsPageProps {
  searchParams: Promise<{
    site_id?: string | string[];
    from?: string | string[];
    to?: string | string[];
    dimension?: string | string[];
    definition_version?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const siteConfig = getDashboardSiteConfig();
  if (!siteConfig.config) {
    return (
      <main className="dashboard-shell bg-canvas text-ink">
        <DashboardHeader settingsMode />
        <div className="dashboard-container py-8">
          <section className="card">
            <ErrorState message={`Dashboard site configuration is invalid: ${siteConfig.error}.`} />
          </section>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  const requestedSite = firstValue(params.site_id);
  const siteId =
    requestedSite && siteConfig.config.sites.includes(requestedSite)
      ? requestedSite
      : siteConfig.config.defaultSite;
  const environment = getConfigurationEnvironment();
  const requestedDimension = firstValue(params.dimension);
  const dimension = ANALYTICS_DIMENSIONS.find((value) => value === requestedDimension) ?? "browser";
  const dateRange = { from: firstValue(params.from) ?? "", to: firstValue(params.to) ?? "" };
  const definitionVersion = firstValue(params.definition_version);

  return (
    <DashboardShell
      dateRange={dateRange}
      siteId={siteId}
      sites={siteConfig.config.sites}
      dimension={dimension}
      definitionVersion={definitionVersion}
      settingsMode
    >
      {!environment ? (
        <section className="card">
          <ErrorState message="DASHBOARD_DEFAULT_ENVIRONMENT is not configured on the Dashboard server." />
        </section>
      ) : (
        <>
          <ConfigurationEditor
            environment={environment}
            siteId={siteId}
            result={await loadSiteConfiguration(siteId, environment)}
          />
          <DefinitionEditor siteId={siteId} result={await loadSiteDefinitions(siteId)} />
        </>
      )}
    </DashboardShell>
  );
}
