import path from "node:path";

export async function validateConfigurationOpenApi({
  contractRoot,
  readJson,
  makeValidator,
  openapi,
  fail,
  pass,
}) {
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
      if (
        !parameters.some((parameter) => parameter?.name === requiredHeader && parameter.required)
      ) {
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
    openapi.paths["/v1/admin/sites/{site_id}/conversion-funnel-definitions"].put.requestBody
      .content["application/json"].schema.$ref !==
      "conversion-funnel-definition-set-update.schema.json"
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
    openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys"].post
      .responses["201"].content["application/json"].schema.$ref !==
      "#/components/schemas/CreatedIngestKey" ||
    openapi.paths["/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys"].post
      .responses["201"].headers["Cache-Control"].schema.const !== "no-store" ||
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
}
