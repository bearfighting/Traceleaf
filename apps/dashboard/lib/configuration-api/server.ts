import "server-only";

import { getAnalyticsApiUrl } from "../analytics-api/config";

import type { CapabilityResponse, IngestPolicyResponse } from "./types";

export type ConfigurationLoadResult =
  | { kind: "ready"; capabilities: CapabilityResponse; policy: IngestPolicyResponse | null }
  | { kind: "unconfigured"; message: string }
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
    const base = getAnalyticsApiUrl();
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
      return { kind: "error", message: await readApiError(capabilitiesResponse) };
    }
    if (policyResponse.status !== 404 && !policyResponse.ok) {
      return { kind: "error", message: await readApiError(policyResponse) };
    }

    const capabilities = (await capabilitiesResponse.json()) as CapabilityResponse;
    const policy = policyResponse.ok
      ? ((await policyResponse.json()) as IngestPolicyResponse)
      : null;

    return { kind: "ready", capabilities, policy };
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
