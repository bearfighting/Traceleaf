import React from "react";

import { ConfigurationEditor } from "../../../components/configuration-editor";
import { DashboardShell } from "../../../components/dashboard-shell";
import { DefinitionEditor } from "../../../components/definition-editor";
import { ErrorState } from "../../../components/states/error-state";
import { getDashboardSiteConfig } from "../../../config/sites";
import {
  getConfigurationEnvironment,
  loadSiteConfiguration,
  loadSiteDefinitions,
} from "../../../lib/configuration-api/server";

export const dynamic = "force-dynamic";

interface SettingsPageProps {
  searchParams: Promise<{ site_id?: string | string[] }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const siteConfig = getDashboardSiteConfig();
  if (!siteConfig.config) {
    return (
      <main className="dashboard-shell">
        <section className="card">
          <ErrorState message={`Dashboard site configuration is invalid: ${siteConfig.error}.`} />
        </section>
      </main>
    );
  }

  const params = await searchParams;
  const requestedSite = Array.isArray(params.site_id) ? params.site_id[0] : params.site_id;
  const siteId =
    requestedSite && siteConfig.config.sites.includes(requestedSite)
      ? requestedSite
      : siteConfig.config.defaultSite;
  const environment = getConfigurationEnvironment();

  return (
    <DashboardShell
      dateRange={{ from: "", to: "" }}
      siteId={siteId}
      sites={siteConfig.config.sites}
      dimension="browser"
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
