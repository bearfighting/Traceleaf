/* global console, process */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateOpenApi } from "./analytics-openapi-validation.mjs";
import { validateQueryCases } from "./analytics-query-case-validation.mjs";
import { validateFixture } from "./analytics-fixture-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const openapiPath = path.join(root, "docs", "analytics-api.openapi.json");
const contractRoot = path.join(root, "protocol", "contracts", "analytics-api", "current");
const fixturesDirectory = path.join(contractRoot, "fixtures");
const queryCasesPath = path.join(contractRoot, "api-contract-cases.json");
const requiredIds = new Set([
  "single-page-view",
  "multi-page-navigation",
  "duplicate-events",
  "late-event",
  "multi-site-isolation",
  "empty-date-range",
  "all-time-overview",
  "custom-events",
  "web-vitals",
  "conversion-funnels",
  "geo-countries",
]);
const errors = [];

const openapi = await readJson(openapiPath, "OpenAPI contract");
if (openapi) validateOpenApi(openapi, errors);
const queryCases = await readJson(queryCasesPath, "Analytics API contract cases");
if (queryCases) validateQueryCases(queryCases, errors);

const fixtureNames = (await readdir(fixturesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const ids = new Set();
for (const fixtureName of fixtureNames) {
  const fixture = await readJson(path.join(fixturesDirectory, fixtureName), fixtureName);
  if (fixture) validateFixture(fixture, fixtureName, ids, errors);
}

for (const id of requiredIds) {
  if (!ids.has(id)) errors.push(`missing required fixture '${id}'`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated analytics contract and ${fixtureNames.length} fixtures.`);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return null;
  }
}
