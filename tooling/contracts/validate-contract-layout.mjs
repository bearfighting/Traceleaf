import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const protocolRoot = path.join(root, "protocol");
const errors = [];

const requiredFiles = [
  "capabilities/capabilities.json",
  "capabilities/capability-contract.schema.json",
  "contexts/browser-context.schema.json",
  "contracts/analytics-api/current/api-contract-cases.json",
  "contracts/configuration/current/README.md",
  "contracts/configuration/current/capabilities.schema.json",
  "contracts/configuration/current/capability-update.schema.json",
  "contracts/configuration/current/environment-policy.schema.json",
  "contracts/configuration/current/environment-policy-update.schema.json",
  "contracts/configuration/current/audit-event.schema.json",
  "contracts/configuration/current/site-create-request.schema.json",
  "contracts/configuration/current/site-metadata-update.schema.json",
  "contracts/configuration/current/site-management-audit-event.schema.json",
  "contracts/configuration/current/site-management-persistence.md",
  "contracts/configuration/current/openapi.json",
  "contracts/configuration/current/fixtures/api-mutation-cases.json",
  "contracts/configuration/current/fixtures/effective-state-cases.json",
  "contracts/configuration/current/fixtures/legacy-mapping-cases.json",
  "contracts/configuration/current/fixtures/policy-semantic-cases.json",
  "contracts/configuration/current/fixtures/site-management-cases.json",
  "contracts/http-ingestion/current/config/collector.example.toml",
  "contracts/http-ingestion/current/config/collector.e2e.toml",
  "scenarios/analytics-semantics/cases.json",
];

const forbiddenPaths = [
  "events/v1",
  "events/v2",
  "events/compatibility",
  "contexts/v1",
  "capabilities/v1",
  "scenarios/analytics-semantics/v1",
  "contracts/analytics-api/v1",
  "contracts/http-ingestion/v1",
];

for (const relativePath of requiredFiles) {
  try {
    await access(path.join(protocolRoot, relativePath));
  } catch {
    errors.push(`missing canonical resource: protocol/${relativePath}`);
  }
}

for (const relativePath of forbiddenPaths) {
  try {
    await access(path.join(protocolRoot, relativePath));
    errors.push(`forbidden legacy namespace exists: protocol/${relativePath}`);
  } catch {
    // Expected: legacy namespace must not exist.
  }
}

const scanRoots = [
  "packages",
  "services",
  "apps",
  "scripts",
  "protocol",
  "compose.yaml",
  "compose.e2e.yaml",
];
const forbiddenText = [
  "protocol/events/v1",
  "protocol/events/v2",
  "protocol/events/compatibility",
  "protocol/contexts/v1",
  "protocol/capabilities/v1",
  "protocol/scenarios/analytics-semantics/v1",
  "protocol/contracts/analytics-api/v1",
  "protocol/contracts/http-ingestion/v1",
  "v1-to-v2",
  "legacy_v2",
  "rejects_legacy_v2_batch",
];

for (const relativePath of scanRoots) {
  await scan(path.join(root, relativePath));
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Contract namespace layout validated successfully.");
}

async function scan(filePath) {
  let entries;
  try {
    entries = (await readdir(filePath, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    await scanFile(filePath);
    return;
  }

  for (const entry of entries) {
    await scan(path.join(filePath, entry.name));
  }
}

async function scanFile(filePath) {
  if (path.resolve(filePath) === path.resolve(fileURLToPath(import.meta.url))) return;

  const supported = [".json", ".mjs", ".ts", ".rs", ".yaml", ".toml", ".sh"];
  if (!supported.some((extension) => filePath.endsWith(extension))) return;

  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const forbidden of forbiddenText) {
    if (contents.includes(forbidden)) {
      errors.push(`legacy namespace reference '${forbidden}' in ${path.relative(root, filePath)}`);
    }
  }
}
