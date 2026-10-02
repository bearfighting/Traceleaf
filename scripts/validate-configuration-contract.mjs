import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractRoot = path.join(root, "protocol/contracts/configuration/current");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const errors = [];
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => errors.push(message);
const makeValidator = (schema) => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
};

const capabilitySchema = await readJson(path.join(contractRoot, "capabilities.schema.json"));
const policySchema = await readJson(path.join(contractRoot, "environment-policy.schema.json"));
const capabilityUpdateSchema = await readJson(
  path.join(contractRoot, "capability-update.schema.json"),
);
const policyUpdateSchema = await readJson(
  path.join(contractRoot, "environment-policy-update.schema.json"),
);
const auditSchema = await readJson(path.join(contractRoot, "audit-event.schema.json"));
const siteCreateSchema = await readJson(path.join(contractRoot, "site-create-request.schema.json"));
const siteMetadataUpdateSchema = await readJson(
  path.join(contractRoot, "site-metadata-update.schema.json"),
);
const siteManagementAuditSchema = await readJson(
  path.join(contractRoot, "site-management-audit-event.schema.json"),
);
const manifest = await readJson(path.join(root, "protocol/capabilities/capabilities.json"));
const openapi = await readJson(path.join(contractRoot, "openapi.json"));
const validateCapabilities = makeValidator(capabilitySchema);
const validatePolicy = makeValidator(policySchema);
const validateCapabilityUpdate = makeValidator(capabilityUpdateSchema);
const validatePolicyUpdate = makeValidator(policyUpdateSchema);
const validateAudit = makeValidator(auditSchema);
const validateSiteCreate = makeValidator(siteCreateSchema);
const validateSiteMetadataUpdate = makeValidator(siteMetadataUpdateSchema);
const validateSiteManagementAudit = makeValidator(siteManagementAuditSchema);
if (
  siteCreateSchema.properties.capabilities.properties.page_views?.const !== true ||
  siteCreateSchema.properties.capabilities.default?.page_views !== true
) {
  fail(
    "Site creation must fix page_views to true when supplied and normalize it to true when omitted",
  );
}
const capabilityIds = manifest.capabilities.map(({ id }) => id).sort();
const expectedIds = [
  "anonymous_visitors",
  "browser_context",
  "conversions",
  "custom_events",
  "dimensions",
  "funnels",
  "geo",
  "page_views",
  "sessions",
  "web_vitals",
];
if (JSON.stringify(capabilityIds) !== JSON.stringify(expectedIds)) {
  fail("canonical manifest must contain the ten frozen capability IDs");
}
if (manifest.capabilities.some(({ status }) => status !== "implemented")) {
  fail("all ten canonical capabilities must currently be implemented");
}
const schemaIds = Object.keys(capabilitySchema.properties.capabilities.properties).sort();
if (JSON.stringify(schemaIds) !== JSON.stringify(capabilityIds)) {
  fail("configuration schema capability IDs must match the canonical manifest");
}
const updateIds = Object.keys(capabilityUpdateSchema.properties.capabilities.properties).sort();
if (JSON.stringify(updateIds) !== JSON.stringify(capabilityIds)) {
  fail("capability update schema IDs must match the canonical manifest");
}
if (policySchema.properties.rate_limit_per_minute.default !== 600) {
  fail("environment policy default limit must remain 600 requests per minute");
}
pass("capability IDs and implemented status match the canonical manifest");

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
              semanticErrors.push("website_url must not contain username or password credentials");
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
        if (resource.kind === "environment_policy" && (!resource.environment || resource.key_id)) {
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

const policySemanticCases = await readJson(
  path.join(contractRoot, "fixtures/policy-semantic-cases.json"),
);
for (const testCase of policySemanticCases.cases) {
  const keys = new Set();
  const origins = new Set();
  let valid = true;
  for (const policy of testCase.policies) {
    const identity = `${policy.site_id}:${policy.environment}`;
    if (keys.has(identity)) valid = false;
    keys.add(identity);
    for (const origin of policy.allowed_origins) {
      let canonical = false;
      try {
        const parsed = new URL(origin);
        canonical =
          ["http:", "https:"].includes(parsed.protocol) &&
          parsed.origin === origin &&
          !parsed.username &&
          !parsed.password;
      } catch {
        canonical = false;
      }
      if (!canonical) valid = false;
      const originIdentity = `${policy.site_id}:${new URL(origin).origin}`;
      if (origins.has(originIdentity)) valid = false;
      origins.add(originIdentity);
    }
  }
  if (valid !== testCase.expected_valid) fail(`policy semantic case failed: ${testCase.id}`);
  else pass(`policy semantic ${testCase.id}`);
}

const migrationCases = await readJson(
  path.join(contractRoot, "fixtures/legacy-mapping-cases.json"),
);
const legacyGroup = ["browser_context", "anonymous_visitors", "sessions", "dimensions"];
for (const testCase of migrationCases.cases) {
  const legacyEnabled = testCase.legacy_analytics_enabled === true;
  const expected = Object.fromEntries(manifest.capabilities.map(({ id }) => [id, true]));
  for (const id of legacyGroup) expected[id] = legacyEnabled;
  const result = { ...expected, page_views: true };
  if (JSON.stringify(result) !== JSON.stringify(testCase.expected)) {
    fail(`legacy mapping case failed: ${testCase.id}`);
  } else {
    pass(`legacy mapping ${testCase.id}`);
  }
}

const siteManagementCases = await readJson(
  path.join(contractRoot, "fixtures/site-management-cases.json"),
);
const normalization = siteManagementCases.normalization;
const canonicalCapabilities = Object.fromEntries(
  capabilityIds.map((id) => [
    id,
    id === "page_views" || normalization.input.capabilities?.[id] === true,
  ]),
);
let normalizedOrigins = [];
try {
  normalizedOrigins = normalization.input.allowed_origins
    .map((origin) => new URL(origin).origin)
    .sort();
} catch {
  fail("Site creation normalization fixture contains an invalid Origin");
}
const normalizedWebsiteUrl = new URL(normalization.input.website_url);
normalizedWebsiteUrl.hash = "";
const normalizedRequest = {
  display_name: normalization.input.display_name.trim().normalize("NFC"),
  website_url: normalizedWebsiteUrl.href,
  environment: normalization.input.environment,
  capabilities: canonicalCapabilities,
  allowed_origins: normalizedOrigins,
};
if (
  JSON.stringify(normalizedRequest) !== JSON.stringify(normalization.canonical) ||
  normalization.digest_algorithm !== "SHA-256" ||
  normalization.canonical_json !== "RFC 8785"
) {
  fail("Site creation normalization fixture does not match its declared canonical request");
} else {
  pass("site creation normalization, default capabilities and digest contract");
}
if (
  siteManagementCases.retries.length !== 4 ||
  siteManagementCases.retries.some((testCase) =>
    testCase.id === "same-key-same-request"
      ? testCase.expected_status !== 200 || testCase.returns_plaintext_key !== false
      : testCase.id === "same-key-different-request"
        ? testCase.expected_status !== 409 ||
          testCase.expected_error !== "site_idempotency_conflict"
        : testCase.id === "concurrent-same-key-same-request"
          ? testCase.one_site_created !== true || testCase.one_initial_plaintext_response !== true
          : testCase.id === "concurrent-same-key-different-request"
            ? testCase.one_request_commits !== true || testCase.other_response_status !== 409
            : true,
  ) ||
  siteManagementCases.retention.idempotency_association !== "site_lifetime_including_archive" ||
  siteManagementCases.retention.site_audit !== "site_lifetime_including_archive" ||
  siteManagementCases.retention.physical_site_delete !== false
) {
  fail("Site creation retry, concurrency or lifetime-retention contract fixture is inconsistent");
} else {
  pass("site creation idempotency replay, conflict, concurrency and retention cases");
}
if (
  siteManagementCases.create_defaults.environment_policy_enabled !== true ||
  siteManagementCases.create_defaults.rate_limit_per_minute !== 600 ||
  siteManagementCases.create_defaults.generated_ingest_key_active !== true
) {
  fail("Site creation must create an enabled 600/minute policy with its initial key active");
} else {
  pass("site creation initial environment policy and active key defaults");
}

const requiredPaths = {
  "/v1/admin/sites": ["get", "post"],
  "/v1/admin/sites/{site_id}": ["get", "patch"],
  "/v1/admin/sites/{site_id}/archive": ["post"],
  "/v1/admin/sites/{site_id}/restore": ["post"],
  "/v1/admin/sites/{site_id}/capabilities": ["get", "post", "put"],
  "/v1/admin/sites/{site_id}/conversion-funnel-definitions": ["get", "post", "put"],
  "/v1/sites/{site_id}/definition-revisions": ["get"],
  "/v1/admin/sites/{site_id}/environments/{environment}/ingest-policy": ["get", "post", "put"],
  "/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys": ["post"],
  "/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys/{key_id}": ["delete"],
};
if (
  JSON.stringify(
    Object.fromEntries(
      Object.entries(openapi.paths)
        .map(([route, methods]) => [
          route,
          Object.keys(methods)
            .filter((method) => ["get", "put", "post", "patch", "delete"].includes(method))
            .sort(),
        ])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  ) !==
  JSON.stringify(
    Object.fromEntries(
      Object.entries(requiredPaths)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([route, methods]) => [route, methods.sort()]),
    ),
  )
) {
  fail("OpenAPI configuration routes do not match the frozen route set");
}
if (
  openapi.components.schemas.CreatedManagedSite.allOf?.[1]?.properties?.site_id?.pattern !==
  "^site_[0-7][0-9A-HJKMNP-TV-Z]{25}$"
) {
  fail("newly created Site IDs must be prefixed ULIDs with a valid first character");
}
if (!openapi.security?.some((requirement) => requirement.configAdminBearer)) {
  fail("all configuration API routes must inherit deployment-admin Bearer authentication");
}
for (const [route, methods] of Object.entries(openapi.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!["put", "post", "patch", "delete"].includes(method)) continue;
    const parameters = [...(methods.parameters ?? []), ...(operation.parameters ?? [])].map(
      (parameter) =>
        parameter.$ref
          ? openapi.components.parameters[parameter.$ref.split("/").at(-1)]
          : parameter,
    );
    const requiredHeader =
      method === "post" && route === "/v1/admin/sites"
        ? "Idempotency-Key"
        : method === "post" && route.endsWith("/conversion-funnel-definitions")
          ? "If-None-Match"
          : method === "post" && route.endsWith("/ingest-policy")
            ? "If-None-Match"
            : method === "post" && route.endsWith("/capabilities")
              ? "If-None-Match"
              : "If-Match";
    if (!parameters.some((parameter) => parameter?.name === requiredHeader && parameter.required)) {
      fail(`${method.toUpperCase()} ${route} must require ${requiredHeader}`);
    }
  }
}
const openapiText = JSON.stringify(openapi);
if (openapiText.includes("sha256_digest") || openapiText.includes("CONFIG_ADMIN_TOKENS:")) {
  fail("OpenAPI responses must not expose stored key digests or bootstrap credentials");
}
if (
  openapi.paths["/v1/admin/sites/{site_id}/capabilities"].put.requestBody.content[
    "application/json"
  ].schema.$ref !== "capability-update.schema.json" ||
  openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-policy"].put
    .requestBody.content["application/json"].schema.$ref !==
    "environment-policy-update.schema.json" ||
  openapi.paths["/v1/admin/sites/{site_id}/conversion-funnel-definitions"].put.requestBody.content[
    "application/json"
  ].schema.$ref !== "conversion-funnel-definition-set-update.schema.json"
) {
  fail("PUT operations must use their dedicated client update schemas");
}
for (const route of Object.values(openapi.paths)) {
  for (const operation of Object.values(route)) {
    if (!operation || typeof operation !== "object" || !operation.requestBody) continue;
    const schemaRef = operation.requestBody.content?.["application/json"]?.schema?.$ref;
    if (!schemaRef || !schemaRef.endsWith(".schema.json")) continue;
    try {
      const referenced = await readJson(path.join(contractRoot, schemaRef));
      makeValidator(referenced);
    } catch (error) {
      fail("unresolvable OpenAPI request schema " + schemaRef + ": " + error.message);
    }
  }
}
if (
  openapi.components.parameters.IfMatch.schema.pattern !== '^"[1-9][0-9]*"$' ||
  openapi.components.headers.VersionETag.schema.pattern !== '^"[1-9][0-9]*"$'
) {
  fail("If-Match and ETag must use quoted positive configuration versions");
}
if (
  openapi.components.parameters.IfNoneMatch.name !== "If-None-Match" ||
  openapi.components.parameters.IfNoneMatch.schema.const !== "*"
) {
  fail("create-only configuration operations must require If-None-Match: *");
}
if (
  !openapiText.includes("configuration_version_conflict") ||
  !openapiText.includes("CreatedIngestKey") ||
  !openapiText.includes("only time the plaintext key is returned")
) {
  fail("OpenAPI must define conflict and one-time plaintext key semantics");
}
const keyResponseRefs = openapiText.match(/CreatedIngestKey/g) ?? [];
if (
  openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys"].post.responses[
    "201"
  ].content["application/json"].schema.$ref !== "#/components/schemas/CreatedIngestKey" ||
  openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys"].post.responses[
    "201"
  ].headers["Cache-Control"].schema.const !== "no-store" ||
  keyResponseRefs.length !== 2
) {
  fail("only key creation may return the one-time plaintext key");
}
const mutationResponses = {
  capabilityCreate: openapi.paths["/v1/admin/sites/{site_id}/capabilities"].post.responses,
  put: openapi.paths["/v1/admin/sites/{site_id}/capabilities"].put.responses,
  policyPut:
    openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-policy"].put
      .responses,
  policyCreate:
    openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-policy"].post
      .responses,
  keyPost:
    openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys"].post
      .responses,
  keyDelete:
    openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys/{key_id}"]
      .delete.responses,
};
for (const [operation, responses] of Object.entries(mutationResponses)) {
  for (const [status, name] of [
    ["401", "Unauthorized"],
    ["409", "VersionConflict"],
    ["428", "PreconditionRequired"],
    ["503", "Unavailable"],
  ]) {
    if (responses[status]?.$ref !== `#/components/responses/${name}`)
      fail(`${operation} must define ${status} ${name}`);
  }
}
if (
  mutationResponses.put["422"]?.$ref !== "#/components/responses/ValidationError" ||
  mutationResponses.policyPut["422"]?.$ref !== "#/components/responses/ValidationError" ||
  mutationResponses.policyCreate["422"]?.$ref !== "#/components/responses/ValidationError"
) {
  fail("configuration mutations must define 422 validation errors");
}
const mutationCases = await readJson(path.join(contractRoot, "fixtures/api-mutation-cases.json"));
for (const testCase of mutationCases.cases) {
  const expectedStatus = String(testCase.expected_status);
  const operation = openapi.paths[testCase.path]?.[testCase.method.toLowerCase()];
  const response = operation?.responses[expectedStatus];
  if (!response) {
    fail(
      `API mutation fixture has no matching ${testCase.method} ${testCase.path} ${expectedStatus} response: ${testCase.id}`,
    );
  }
  if (testCase.expected_error && response?.$ref) {
    const responseName = response.$ref.split("/").at(-1);
    const responseSchemaRef =
      openapi.components.responses[responseName]?.content?.["application/json"]?.schema?.$ref;
    const schemaName = responseSchemaRef?.split("/").at(-1);
    const responseSchema = openapi.components.schemas[schemaName];
    const responseErrorCode = responseSchema?.allOf
      ?.map((part) => part.properties?.error?.properties?.code?.const)
      .find((code) => code !== undefined);
    if (responseErrorCode !== testCase.expected_error) {
      fail(
        `API mutation fixture error mismatch for ${testCase.method} ${testCase.path} ${expectedStatus}: ${testCase.id}`,
      );
    }
  } else if (testCase.expected_error) {
    fail(`API mutation error response must reference a code-constrained schema: ${testCase.id}`);
  }
  if (testCase.partial_update !== undefined && testCase.partial_update !== false) {
    fail(`failed mutation must be atomic: ${testCase.id}`);
  }
  if (testCase.stored_digest_exposed !== undefined && testCase.stored_digest_exposed !== false) {
    fail(`stored key digest must not be exposed: ${testCase.id}`);
  }
  if (
    testCase.id === "create-ingest-key" &&
    (!testCase.plaintext_returned_once ||
      !openapiText.includes("only time the plaintext key is returned"))
  ) {
    fail("Ingest Key plaintext must be one-time only");
  }
  if (testCase.id === "create-site" && (!testCase.plaintext_returned_once || !testCase.atomic)) {
    fail("Site creation must commit atomically and return plaintext only on its initial success");
  }
  if (testCase.id === "retry-create-site" && testCase.plaintext_returned_once !== false) {
    fail("Site creation retry must not return plaintext Ingest Key material");
  }
}
pass("OpenAPI routes, Bearer auth, version preconditions and one-time key response validated");

const effectiveStateCases = await readJson(
  path.join(contractRoot, "fixtures/effective-state-cases.json"),
);
for (const testCase of effectiveStateCases.cases) {
  const expectedStatus = !testCase.storage_available
    ? "stale"
    : testCase.all_affected_services_applied
      ? "current"
      : "pending";
  if (expectedStatus !== testCase.expected_status) {
    fail(`effective-state precedence case failed: ${testCase.id}`);
  } else {
    pass(`effective-state ${testCase.id}`);
  }
}
const statusDescription = openapi.components.schemas.EffectiveState.properties.status.description;
if (!statusDescription.includes("stale > pending > current")) {
  fail("OpenAPI must document stale-over-pending effective-state precedence");
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Configuration contracts validated successfully.");
}
