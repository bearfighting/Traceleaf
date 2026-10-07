import { configurationRequestError } from "../../lib/configuration-api/errors";

import type { CapabilityDraft } from "./capability-domain";
import type { CapabilityResponse } from "../../lib/configuration-api/types";

function capabilitiesUrl(siteId: string) {
  return `/api/admin/sites/${encodeURIComponent(siteId)}/capabilities`;
}

async function readCapabilityResponse(response: Response): Promise<CapabilityResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(configurationRequestError(response.status, body));

  return body as CapabilityResponse;
}

export async function initializeCapabilities(siteId: string): Promise<void> {
  const response = await fetch(capabilitiesUrl(siteId), {
    method: "POST",
    headers: { "If-None-Match": "*" },
    cache: "no-store",
  });
  await readCapabilityResponse(response);
}

export async function saveCapabilities(
  siteId: string,
  version: number,
  capabilities: CapabilityDraft,
) {
  const response = await fetch(capabilitiesUrl(siteId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
    body: JSON.stringify({ capabilities }),
    cache: "no-store",
  });

  return readCapabilityResponse(response);
}
