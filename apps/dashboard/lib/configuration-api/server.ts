import "server-only";

import { getSiteManagementApiUrl } from "../site-management/config";

import type { CapabilityResponse, IngestPolicyResponse } from "./types";

export type ConfigurationLoadResult =
  | { kind: "ready"; capabilities: CapabilityResponse; policy: IngestPolicyResponse | null }
  | { kind: "missing_capabilities"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "environment_unconfigured"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "error"; message: string };

export function getConfigurationEnvironment(): string | undefined {
  const value = process.env.DASHBOARD_DEFAULT_ENVIRONMENT?.trim();

  return value || undefined;
}

export async function loadSiteConfiguration(
  siteId: string,
  environment: string,
): Promise<ConfigurationLoadResult> {
  const token = process.env.DASHBOARD_CONFIG_ADMIN_TOKEN;
  if (!token) {
    return {
      kind: "unconfigured",
      message: "DASHBOARD_CONFIG_ADMIN_TOKEN is not configured for the Dashboard server.",
    };
  }

  try {
    const base = getSiteManagementApiUrl();
    const headers = { Authorization: `Bearer ${token}` };
    const [capabilitiesResponse, policyResponse] = await Promise.all([
      fetch(`${base}/v1/admin/sites/${encodeURIComponent(siteId)}/capabilities`, {
        headers,
        cache: "no-store",
      }),
      fetch(
        `${base}/v1/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`,
        { headers, cache: "no-store" },
      ),
    ]);

    if (!capabilitiesResponse.ok) {
      if (capabilitiesResponse.status === 401 || capabilitiesResponse.status === 403)
        return { kind: "unauthorized", message: await readApiError(capabilitiesResponse) };
      if (capabilitiesResponse.status !== 404)
        return { kind: "error", message: await readApiError(capabilitiesResponse) };
    }
    if (policyResponse.status !== 404 && !policyResponse.ok) {
      if (policyResponse.status === 401 || policyResponse.status === 403)
        return { kind: "unauthorized", message: await readApiError(policyResponse) };

      return { kind: "error", message: await readApiError(policyResponse) };
    }
    if (capabilitiesResponse.status === 404)
      return {
        kind: "missing_capabilities",
        message: "No capability configuration exists for this Site.",
      };

    const capabilities = (await capabilitiesResponse.json()) as CapabilityResponse;
    const policy = policyResponse.ok
      ? ((await policyResponse.json()) as IngestPolicyResponse)
      : null;

    return { kind: "ready", capabilities, policy };
  } catch {
    return { kind: "error", message: "Configuration service is unavailable. Try again later." };
  }
}

export async function loadSiteCapabilities(siteId: string): Promise<ConfigurationLoadResult> {
  const token = process.env.DASHBOARD_CONFIG_ADMIN_TOKEN;
  if (!token)
    return {
      kind: "unconfigured",
      message: "DASHBOARD_CONFIG_ADMIN_TOKEN is not configured for the Dashboard server.",
    };
  try {
    const response = await fetch(
      `${getSiteManagementApiUrl()}/v1/admin/sites/${encodeURIComponent(siteId)}/capabilities`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (response.status === 404)
      return {
        kind: "missing_capabilities",
        message: "No capability configuration exists for this Site.",
      };
    if (response.status === 401 || response.status === 403)
      return { kind: "unauthorized", message: await readApiError(response) };
    if (!response.ok) return { kind: "error", message: await readApiError(response) };

    return {
      kind: "ready",
      capabilities: (await response.json()) as CapabilityResponse,
      policy: null,
    };
  } catch {
    return { kind: "error", message: "Configuration service is unavailable. Try again later." };
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };

    return body.error?.message ?? `Configuration API returned HTTP ${response.status}.`;
  } catch {
    return `Configuration API returned HTTP ${response.status}.`;
  }
}

export type DefinitionLoadResult =
  | { kind: "ready"; definitions: import("./types").DefinitionSetResponse | null }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

export async function loadSiteDefinitions(siteId: string): Promise<DefinitionLoadResult> {
  const token = process.env.DASHBOARD_CONFIG_ADMIN_TOKEN;
  if (!token)
    return {
      kind: "unconfigured",
      message: "DASHBOARD_CONFIG_ADMIN_TOKEN is not configured for the Dashboard server.",
    };
  try {
    const response = await fetch(
      `${getSiteManagementApiUrl()}/v1/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (response.status === 404) return { kind: "ready", definitions: null };
    if (!response.ok) return { kind: "error", message: await readApiError(response) };

    return {
      kind: "ready",
      definitions: (await response.json()) as import("./types").DefinitionSetResponse,
    };
  } catch {
    return { kind: "error", message: "Configuration service is unavailable. Try again later." };
  }
}
