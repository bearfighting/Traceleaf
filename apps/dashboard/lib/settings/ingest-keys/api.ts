import { configurationRequestError } from "../configuration-api/errors";

import { isCreatedIngestKey, isIngestPolicyResponse } from "./validation";

import type { CreatedIngestKey, IngestPolicyResponse } from "../configuration-api/types";

const basePath = (siteId: string, environment: string) =>
  `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}`;

export async function fetchIngestPolicy(siteId: string, environment: string) {
  const response = await fetch(`${basePath(siteId, environment)}/ingest-policy`, {
    cache: "no-store",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(configurationRequestError(response.status, value));
  if (!isIngestPolicyResponse(value, siteId, environment))
    throw new Error("The active key list response could not be verified.");

  return value;
}

export async function createIngestKey(
  siteId: string,
  environment: string,
  version: number,
): Promise<CreatedIngestKey> {
  const response = await fetch(`${basePath(siteId, environment)}/ingest-keys`, {
    method: "POST",
    headers: { "If-Match": `"${version}"` },
    cache: "no-store",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(new Error(configurationRequestError(response.status, value)), {
      status: response.status,
    });
  if (!isCreatedIngestKey(value)) throw new Error("The key response could not be verified.");

  return value;
}

export async function revokeIngestKey(
  siteId: string,
  environment: string,
  keyId: string,
  version: number,
): Promise<IngestPolicyResponse> {
  const response = await fetch(
    `${basePath(siteId, environment)}/ingest-keys/${encodeURIComponent(keyId)}`,
    {
      method: "DELETE",
      headers: { "If-Match": `"${version}"` },
      cache: "no-store",
    },
  );
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(configurationRequestError(response.status, value));
  if (!isIngestPolicyResponse(value, siteId, environment))
    throw new Error("The policy response could not be verified.");

  return value;
}
