import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFixture } from "./http-fixture-validation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDirectory = path.join(
  repositoryRoot,
  "protocol",
  "contracts",
  "http-ingestion",
  "current",
  "fixtures",
);
const allowedStatuses = new Set([200, 202, 204, 400, 401, 403, 413, 415, 429, 500]);
const requiredFixtureIds = new Set([
  "health-success",
  "accepted-single-event",
  "accepted-multi-event",
  "accepted-unknown-fields",
  "accepted-charset",
  "invalid-json",
  "invalid-event-missing-required-field",
  "invalid-event-type",
  "invalid-occurred-at",
  "empty-batch",
  "oversized-batch",
  "oversized-body",
  "unsupported-content-type",
  "mixed-site-ids",
  "unknown-site",
  "disabled-site",
  "missing-origin",
  "disallowed-origin",
  "missing-ingest-key",
  "invalid-ingest-key",
  "preflight-success",
  "preflight-missing-origin",
  "preflight-disallowed-origin",
  "preflight-invalid-method",
  "preflight-invalid-header",
  "origin-wrong-scheme",
  "origin-wrong-host",
  "origin-wrong-port",
  "rate-limited",
  "collector-error",
]);
const ids = new Set();
const errors = [];

const fixtureNames = (await readdir(fixturesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();

if (fixtureNames.length === 0) {
  errors.push("No HTTP fixtures found.");
}

for (const fixtureName of fixtureNames) {
  const fixturePath = path.join(fixturesDirectory, fixtureName);
  let fixture;

  try {
    fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch (error) {
    errors.push(`${fixtureName}: invalid fixture JSON (${error.message})`);
    continue;
  }

  validateFixture(fixture, fixtureName, ids, errors, fixturesDirectory);
}

for (const requiredId of requiredFixtureIds) {
  if (!ids.has(requiredId)) {
    errors.push(`Missing required HTTP fixture '${requiredId}'.`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${fixtureNames.length} HTTP fixtures.`);
}
