import { siteCreateFieldName, type SiteCreationPayload } from "./site-creation-domain";

export type CreatedSite = {
  site: { site_id: string };
  initial_environment: string;
  ingest_key: { key: string; key_id: string };
};

export type SiteCreationResult =
  { kind: "created"; value: CreatedSite } | { kind: "replayed"; siteId: string };

export class SiteCreationRequestError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function createSite(
  payload: SiteCreationPayload,
  key: string,
): Promise<SiteCreationResult> {
  const serialized = JSON.stringify(payload);
  const response = await fetch("/api/admin/sites", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: serialized,
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) {
    const apiError = body?.error;
    const mapped: Record<string, string> = {};
    if (Array.isArray(apiError?.details)) {
      for (const detail of apiError.details) {
        if (typeof detail?.path === "string" && typeof detail?.message === "string")
          mapped[siteCreateFieldName(detail.path)] = detail.message;
      }
    }

    throw new SiteCreationRequestError(
      typeof apiError?.message === "string"
        ? apiError.message
        : "Site creation failed. Check the details and try again.",
      mapped,
    );
  }
  if (response.status === 200) return { kind: "replayed", siteId: body.site.site_id };

  return { kind: "created", value: body as CreatedSite };
}

export async function loadIngestPolicy(siteId: string, environment: string): Promise<string> {
  const response = await fetch(
    `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`,
    { cache: "no-store" },
  );
  if (response.status === 404)
    throw new Error(
      "No environment policy exists. Configure the environment explicitly in Settings before issuing a replacement key.",
    );
  if (!response.ok) {
    const policyError = (await response.json()) as { error?: { message?: string } };

    throw new Error(policyError.error?.message || "Could not load environment policy.");
  }
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Environment policy is missing its version tag.");

  return etag;
}

export async function issueReplacementKey(
  siteId: string,
  environment: string,
  etag: string,
): Promise<string> {
  const response = await fetch(
    `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys`,
    { method: "POST", headers: { "If-Match": etag }, cache: "no-store" },
  );
  const definitelyRejected = !response.ok && response.status < 500;
  let result: { key?: string; error?: { message?: string } };
  try {
    result = await response.json();
  } catch (cause) {
    throw new ReplacementKeyRequestError(
      cause instanceof Error ? cause.message : "The replacement key response was invalid.",
      definitelyRejected,
    );
  }
  if (!response.ok)
    throw new ReplacementKeyRequestError(
      result?.error?.message || "Could not issue a replacement key.",
      definitelyRejected,
    );
  if (!result.key)
    throw new ReplacementKeyRequestError("The replacement key response was invalid.", false);

  return result.key;
}

export class ReplacementKeyRequestError extends Error {
  constructor(
    message: string,
    readonly definitelyRejected: boolean,
  ) {
    super(message);
  }
}
