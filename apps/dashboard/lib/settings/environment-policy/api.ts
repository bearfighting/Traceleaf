import { configurationRequestError } from "../configuration-api/errors";

import type { EnvironmentPolicyPayload } from "./domain";
import type { IngestPolicyResponse } from "../configuration-api/types";

export function environmentPolicyUrl(siteId: string, environment: string): string {
  return `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`;
}

export async function saveEnvironmentPolicy(
  siteId: string,
  environment: string,
  payload: EnvironmentPolicyPayload,
  current: IngestPolicyResponse | null,
): Promise<IngestPolicyResponse> {
  const method = current ? "PUT" : "POST";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (current) headers.set("If-Match", `"${current.policy.version}"`);
  else headers.set("If-None-Match", "*");
  const response = await fetch(environmentPolicyUrl(siteId, environment), {
    method,
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(configurationRequestError(response.status, value));

  return value as IngestPolicyResponse;
}
