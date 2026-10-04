import { getAnalyticsApiUrl } from "./analytics-api/config";

export type DefinitionRevisionHistory =
  | {
      kind: "ready";
      currentVersion: string | null;
      revisions: Array<{ version: string; revision: number; effectiveAt: string | null }>;
    }
  | { kind: "error"; message: string };

export async function loadDefinitionRevisionHistory(
  siteId: string,
): Promise<DefinitionRevisionHistory> {
  try {
    const response = await fetch(
      `${getAnalyticsApiUrl()}/v1/sites/${encodeURIComponent(siteId)}/definition-revisions`,
      { cache: "no-store" },
    );
    if (!response.ok)
      return {
        kind: "error",
        message: "Analytics service could not load definition revision history.",
      };
    const body = (await response.json()) as {
      current_definition_version?: string | null;
      revisions?: Array<{
        definition_version?: string;
        revision?: number;
        effective_at?: string | null;
      }>;
    };
    if (!Array.isArray(body.revisions))
      return { kind: "error", message: "Analytics service returned an invalid revision history." };
    if (
      body.current_definition_version !== undefined &&
      body.current_definition_version !== null &&
      typeof body.current_definition_version !== "string"
    )
      return { kind: "error", message: "Analytics service returned an invalid revision history." };
    if (
      body.revisions.some(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          typeof item.definition_version !== "string" ||
          typeof item.revision !== "number" ||
          !Number.isInteger(item.revision) ||
          item.revision < 1 ||
          (item.effective_at !== undefined &&
            item.effective_at !== null &&
            (typeof item.effective_at !== "string" || Number.isNaN(Date.parse(item.effective_at)))),
      )
    )
      return { kind: "error", message: "Analytics service returned an invalid revision history." };
    const revisions = body.revisions as Array<{
      definition_version: string;
      revision: number;
      effective_at?: string | null;
    }>;

    return {
      kind: "ready",
      currentVersion:
        typeof body.current_definition_version === "string"
          ? body.current_definition_version
          : null,
      revisions: revisions.map((item) => ({
        version: item.definition_version,
        revision: item.revision,
        effectiveAt: item.effective_at ?? null,
      })),
    };
  } catch {
    return {
      kind: "error",
      message: "Analytics service is unavailable. Definition revision history could not be loaded.",
    };
  }
}

export async function loadDefinitionRevisions(
  siteId: string,
): Promise<Array<{ version: string; revision: number }>> {
  const result = await loadDefinitionRevisionHistory(siteId);

  return result.kind === "ready"
    ? result.revisions.map(({ version, revision }) => ({ version, revision }))
    : [];
}
