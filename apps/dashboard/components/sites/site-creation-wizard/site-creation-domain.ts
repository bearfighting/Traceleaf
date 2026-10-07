export type Capability = { id: string; status: string; depends_on: string[] };
export type SiteCreationValues = {
  name: string;
  websiteUrl: string;
  environment: string;
  origins: string[];
};
export type SiteCreationPayload = {
  display_name: string;
  website_url: string;
  environment: string;
  capabilities: Record<string, boolean>;
  allowed_origins: string[];
};

export function deriveOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      return null;

    return parsed.origin;
  } catch {
    return null;
  }
}

export function deriveAllowedOrigins(origins: string[], websiteUrl: string): string[] {
  const websiteOrigin = deriveOrigin(websiteUrl);

  return [...new Set([...origins, ...(websiteOrigin ? [websiteOrigin] : [])])];
}

export function closeCapabilityDependencies(ids: string[], manifest: Capability[]): string[] {
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const enabled = new Set(["page_views", ...ids]);
  const include = (id: string) => {
    const capability = byId.get(id);
    if (!capability) return;
    enabled.add(id);
    capability.depends_on.forEach(include);
  };
  [...enabled].forEach(include);

  return [...enabled].filter((id) => byId.get(id)?.status === "implemented");
}

export function siteCreateFieldName(path: string): string {
  const segments = path
    .replace(/^\/+/, "")
    .split(/[/.]/)
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  const field = ["display_name", "website_url", "allowed_origins"].find((candidate) =>
    segments.includes(candidate),
  );
  const leaf = field ?? [...segments].reverse().find((segment) => !/^\d+$/.test(segment));
  switch (leaf) {
    case "display_name":
      return "name";
    case "website_url":
      return "websiteUrl";
    case "allowed_origins":
      return "origins";
    default:
      return leaf || "form";
  }
}

export function validateSiteCreationStep(
  step: number,
  values: SiteCreationValues,
  allowedOrigins: string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const websiteOrigin = deriveOrigin(values.websiteUrl);
  if (step === 0) {
    if (!values.name.trim()) errors.name = "Enter a Site name.";
    if (!websiteOrigin) errors.websiteUrl = "Enter a valid http or https website URL.";
  }
  if (step === 1) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.environment))
      errors.environment = "Use 1–64 letters, numbers, _ or -, starting with a letter or number.";
    if (!websiteOrigin || !allowedOrigins.includes(websiteOrigin))
      errors.origins = "Allowed Origins must include the website URL Origin.";
  }

  return errors;
}

export function createSitePayload(
  values: SiteCreationValues,
  manifest: Capability[],
  enabledCapabilities: string[],
  allowedOrigins: string[],
): SiteCreationPayload {
  return {
    display_name: values.name.trim(),
    website_url: values.websiteUrl.trim(),
    environment: values.environment,
    capabilities: Object.fromEntries(
      manifest.map((item) => [item.id, enabledCapabilities.includes(item.id)]),
    ),
    allowed_origins: allowedOrigins,
  };
}
