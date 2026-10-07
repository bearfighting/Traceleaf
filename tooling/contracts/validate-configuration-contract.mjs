import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateConfigurationFixtures } from "./configuration-fixture-validation.mjs";
import { validateConfigurationPolicySemantics } from "./configuration-policy-semantics.mjs";
import { validateSiteManagementSemantics } from "./configuration-site-management-semantics.mjs";
import { validateConfigurationOpenApi } from "./configuration-openapi-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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

await validateConfigurationFixtures({
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
});

await validateConfigurationPolicySemantics({ contractRoot, readJson, manifest, fail, pass });

await validateSiteManagementSemantics({ contractRoot, readJson, capabilityIds, fail, pass });

await validateConfigurationOpenApi({ contractRoot, readJson, makeValidator, openapi, fail, pass });

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Configuration contracts validated successfully.");
}
