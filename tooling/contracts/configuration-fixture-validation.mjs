import path from "node:path";

export async function validateConfigurationFixtures({
  contractRoot,
  readdir,
  readJson,
  makeValidator,
  capabilityIds,
  manifest,
  validateCapabilities,
  validatePolicy,
  validateCapabilityUpdate,
  validatePolicyUpdate,
  validateAudit,
  validateSiteCreate,
  validateSiteMetadataUpdate,
  validateSiteManagementAudit,
  pass,
  fail,
}) {
  const dependencyErrors = (configuration) => {
    const errorsFound = [];
    if (configuration.capabilities.page_views.enabled !== true) {
      errorsFound.push("page_views is a required baseline and cannot be disabled");
    }
    for (const capability of manifest.capabilities) {
      if (!configuration.capabilities[capability.id].enabled) continue;
      for (const dependency of capability.depends_on) {
        if (!configuration.capabilities[dependency]?.enabled) {
          errorsFound.push(`${capability.id} requires enabled ${dependency}`);
        }
      }
    }
    return errorsFound;
  };
  for (const kind of [
    "capabilities",
    "environment-policy",
    "capability-update",
    "environment-policy-update",
    "conversion-funnel-definition-set-update",
    "audit",
    "site-create",
    "site-metadata-update",
    "site-management-audit",
  ]) {
    const directory = path.join(contractRoot, "fixtures", kind);
    const validate = {
      capabilities: validateCapabilities,
      "environment-policy": validatePolicy,
      "capability-update": validateCapabilityUpdate,
      "environment-policy-update": validatePolicyUpdate,
      "conversion-funnel-definition-set-update": makeValidator(
        await readJson(
          path.join(contractRoot, "conversion-funnel-definition-set-update.schema.json"),
        ),
      ),
      audit: validateAudit,
      "site-create": validateSiteCreate,
      "site-metadata-update": validateSiteMetadataUpdate,
      "site-management-audit": validateSiteManagementAudit,
    }[kind];
    for (const validity of ["valid", "invalid"]) {
      const fixtureDirectory = path.join(directory, validity);
      for (const filename of (await readdir(fixtureDirectory))
        .filter((name) => name.endsWith(".json"))
        .sort()) {
        const fixture = await readJson(path.join(fixtureDirectory, filename));
        const structurallyValid = validate(fixture);
        let semanticErrors = [];
        if (kind === "capabilities") semanticErrors = dependencyErrors(fixture);
        if (kind === "capability-update") semanticErrors = dependencyErrors(fixture);
        if (kind === "site-create") {
          if (!fixture.display_name.trim().normalize("NFC")) {
            semanticErrors.push("display_name must remain non-empty after normalization");
          }
          const capabilities = Object.fromEntries(
            capabilityIds.map((id) => [
              id,
              { enabled: id === "page_views" || fixture.capabilities?.[id] === true },
            ]),
          );
          semanticErrors.push(...dependencyErrors({ capabilities }));
          try {
            const websiteUrl = new URL(fixture.website_url);
            const websiteOrigin = websiteUrl.origin;
            if (websiteUrl.username || websiteUrl.password) {
              semanticErrors.push("website_url must not contain username or password credentials");
            }
            const allowedOrigins = fixture.allowed_origins.map((origin) => new URL(origin).origin);
            if (new Set(allowedOrigins).size !== allowedOrigins.length) {
              semanticErrors.push("allowed_origins must not contain duplicate canonical Origins");
            }
            if (!allowedOrigins.includes(websiteOrigin)) {
              semanticErrors.push("website_url origin must be included in allowed_origins");
            }
          } catch {
            // Structural validation reports malformed URLs.
          }
        }
        if (kind === "site-metadata-update") {
          if (fixture.display_name !== undefined && !fixture.display_name.trim().normalize("NFC")) {
            semanticErrors.push("display_name must remain non-empty after normalization");
          }
          if (fixture.website_url !== undefined) {
            try {
              const websiteUrl = new URL(fixture.website_url);
              if (websiteUrl.username || websiteUrl.password) {
                semanticErrors.push(
                  "website_url must not contain username or password credentials",
                );
              }
            } catch {
              // Structural validation reports malformed URLs.
            }
          }
        }
        if (kind === "conversion-funnel-definition-set-update") {
          const ids = new Set();
          for (const definition of [...(fixture.conversions ?? []), ...(fixture.funnels ?? [])]) {
            if (ids.has(definition.id))
              semanticErrors.push("definition IDs must be unique within the site definition set");
            ids.add(definition.id);
          }
        }
        if (kind === "audit") {
          const { resource } = fixture;
          if (resource.kind === "site_capabilities" && (resource.environment || resource.key_id)) {
            semanticErrors.push("site capability audit resources must be site-scoped");
          }
          if (
            resource.kind === "environment_policy" &&
            (!resource.environment || resource.key_id)
          ) {
            semanticErrors.push(
              "environment policy audit resources must include only the environment identity",
            );
          }
          if (resource.kind === "ingest_key" && (!resource.environment || !resource.key_id)) {
            semanticErrors.push("ingest key audit resources must include environment and key ID");
          }
          const expiry = new Date(fixture.created_at);
          expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
          if (expiry.toISOString() !== new Date(fixture.expires_at).toISOString()) {
            semanticErrors.push("audit expiry must be exactly one calendar year after creation");
          }
        }
        if (kind === "environment-policy" || kind === "environment-policy-update") {
          for (const origin of fixture.allowed_origins) {
            try {
              const parsed = new URL(origin);
              if (
                !["http:", "https:"].includes(parsed.protocol) ||
                (parsed.pathname !== "" && parsed.pathname !== "/") ||
                parsed.search ||
                parsed.hash ||
                parsed.username ||
                parsed.password
              )
                semanticErrors.push("invalid origin: " + origin);
            } catch {
              semanticErrors.push("invalid canonical origin: " + origin);
            }
          }
        }
        const actualValid = structurallyValid && semanticErrors.length === 0;
        if (actualValid !== (validity === "valid")) {
          fail(
            `unexpected ${kind} fixture result: ${validity}/${filename}; ${JSON.stringify(validate.errors ?? semanticErrors)}`,
          );
        } else {
          pass(`${kind} ${validity}/${filename}`);
        }
      }
    }
  }
}
