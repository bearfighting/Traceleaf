"use client";

import { useRouter } from "next/navigation";

import { Button } from "./ui";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";
import type { ManagedSite } from "../lib/site-management/client";

export type PageViewEvidence =
  { kind: "ready"; pageViews: number } | { kind: "error"; message: string };

export function connectionStatus(
  site: ManagedSite,
  configuration: ConfigurationLoadResult,
  analytics: PageViewEvidence,
) {
  if (site.lifecycle_status === "archived")
    return {
      title: "Archived",
      description: "This Site is archived and cannot receive new events.",
    };
  if (configuration.kind === "environment_unconfigured")
    return { title: "Default environment not configured", description: configuration.message };
  if (configuration.kind === "unconfigured")
    return { title: "Management credentials not configured", description: configuration.message };
  if (configuration.kind === "unauthorized")
    return { title: "Management API authorization failed", description: configuration.message };
  if (configuration.kind === "missing_capabilities")
    return { title: "Setup needs attention", description: configuration.message };
  if (configuration.kind === "error")
    return { title: "Configuration service unavailable", description: configuration.message };
  if (site.setup_status === "needs_attention")
    return {
      title: "Setup needs attention",
      description: "Complete the missing Site requirements before connecting it.",
    };
  if (!configuration.policy)
    return {
      title: "Environment policy missing",
      description: "Configure an ingest policy for this environment.",
    };
  const states = [
    configuration.capabilities.effective_state.status,
    configuration.policy.effective_state.status,
  ];
  if (states.includes("stale"))
    return {
      title: "Configuration out of date",
      description: "A saved configuration change has not been applied by every affected service.",
    };
  if (states.includes("pending"))
    return {
      title: "Configuration pending",
      description: "Saved configuration is waiting to be applied by affected services.",
    };
  if (!configuration.policy.policy.enabled)
    return {
      title: "Environment ingest policy disabled",
      description: "Enable this environment's ingest policy before sending events.",
    };
  if (configuration.policy.policy.allowed_origins.length === 0)
    return {
      title: "Environment Allowed Origins missing",
      description: "Add the observed website's Origin to this environment's ingest policy.",
    };
  if (configuration.policy.policy.keys.length === 0)
    return {
      title: "Environment Ingest Key missing",
      description: "Create an Ingest Key for this environment before sending events.",
    };
  if (analytics.kind === "error")
    return { title: "Analytics status unavailable", description: analytics.message };
  if (analytics.pageViews === 0)
    return {
      title: "Waiting for first event",
      description:
        "Configuration is applied. Send a Page View from the allowed website to confirm the connection.",
    };

  return {
    title: "Site has received Page Views",
    description: `${analytics.pageViews} cumulative Page Views are recorded for this Site. The Analytics API does not attribute them to a specific environment, so this does not confirm events from the selected environment.`,
  };
}

export function SiteConnectionStatus({
  site,
  environment,
  configuration,
  analytics,
}: {
  site: ManagedSite;
  environment: string;
  configuration: ConfigurationLoadResult;
  analytics: PageViewEvidence;
}) {
  const router = useRouter();
  const status = connectionStatus(site, configuration, analytics);
  const missingLabels: Record<string, string> = {
    display_name: "Site name",
    website_url: "Website URL",
    page_views: "Page Views capability",
    environment_ingest_configuration: `Ingest configuration for ${environment}`,
  };

  return (
    <section className="card mb-6" aria-label="Connection status">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Connection status · {environment}</p>
          <h2 className="m-0 text-xl font-semibold">{status.title}</h2>
          <p className="mb-0 mt-1 text-sm text-muted">{status.description}</p>
        </div>
        <Button variant="secondary" onClick={() => router.refresh()}>
          Refresh status
        </Button>
      </div>
      {site.missing_requirements.length > 0 && (
        <p className="mb-0 mt-3 text-sm" role="status">
          Missing requirements:{" "}
          {site.missing_requirements.map((item) => missingLabels[item] ?? item).join(", ")}
        </p>
      )}
      {configuration.kind === "ready" && (
        <dl className="mb-0 mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline font-semibold">Capabilities: </dt>
            <dd className="inline">{configuration.capabilities.effective_state.status}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Ingest policy: </dt>
            <dd className="inline">
              {configuration.policy
                ? configuration.policy.effective_state.status
                : "not configured"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold">Site Page Views (all environments): </dt>
            <dd className="inline">
              {analytics.kind === "ready" ? analytics.pageViews : "unavailable"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
