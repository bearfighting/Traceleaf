import { configurationRequestError } from "../../lib/configuration-api/errors";

import type { DefinitionDraft } from "./definition-domain";
import type { DefinitionSetResponse } from "../../lib/configuration-api/types";

export class DefinitionRequestError extends Error {
  constructor(
    message: string,
    readonly revisionConflict = false,
  ) {
    super(message);
  }
}

function definitionUrl(siteId: string): string {
  return `/api/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`;
}

async function requestDefinitionResponse(response: Response): Promise<DefinitionSetResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new DefinitionRequestError(
      configurationRequestError(response.status, body),
      response.status === 409,
    );

  return body as DefinitionSetResponse;
}

export async function loadLatestDefinitions(siteId: string): Promise<DefinitionSetResponse> {
  const response = await fetch(definitionUrl(siteId), { method: "GET", cache: "no-store" });

  return requestDefinitionResponse(response);
}

export async function saveDefinitions(
  siteId: string,
  revision: number | undefined,
  draft: DefinitionDraft,
): Promise<DefinitionSetResponse> {
  const response = await fetch(definitionUrl(siteId), {
    method: revision === undefined ? "POST" : "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(revision === undefined ? { "If-None-Match": "*" } : { "If-Match": `"${revision}"` }),
    },
    body: JSON.stringify(draft),
    cache: "no-store",
  });

  return requestDefinitionResponse(response);
}
