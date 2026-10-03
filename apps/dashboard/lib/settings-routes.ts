export type SettingsSection =
  "overview" | "definitions" | "capabilities" | "environments" | "ingest-keys";

export interface SettingsRouteContext {
  siteId?: string;
  environment?: string;
  from?: string;
  to?: string;
  dimension?: string;
  definitionVersion?: string;
}

function contextParams(context: SettingsRouteContext): URLSearchParams {
  const params = new URLSearchParams();
  if (context.siteId) params.set("site_id", context.siteId);
  if (context.environment) params.set("environment", context.environment);
  if (context.from) params.set("from", context.from);
  if (context.to) params.set("to", context.to);
  if (context.dimension) params.set("dimension", context.dimension);
  if (context.definitionVersion) params.set("definition_version", context.definitionVersion);

  return params;
}

export function dashboardRoute(context: SettingsRouteContext = {}): string {
  const query = contextParams(context).toString();

  return `/dashboard${query ? `?${query}` : ""}`;
}

export function settingsRoute(
  section: SettingsSection = "overview",
  context: SettingsRouteContext = {},
): string {
  const query = contextParams(context).toString();

  return `/dashboard/settings/${section}${query ? `?${query}` : ""}`;
}

export function legacySettingsRedirect(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  return settingsRoute("overview", {
    siteId: first(searchParams.site_id),
    environment: first(searchParams.environment),
    from: first(searchParams.from),
    to: first(searchParams.to),
    dimension: first(searchParams.dimension),
    definitionVersion: first(searchParams.definition_version),
  });
}
