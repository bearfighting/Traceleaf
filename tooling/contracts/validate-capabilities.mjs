import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const capabilityRoot = path.join(root, "protocol", "capabilities");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const findDependencyCycles = (capabilities) => {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const visit = (id) => {
    if (visiting.has(id)) {
      cycles.push(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of capabilities.get(id)?.depends_on ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of capabilities.keys()) visit(id);
  return cycles;
};

const schema = await readJson(path.join(capabilityRoot, "capability-contract.schema.json"));
const manifest = await readJson(path.join(capabilityRoot, "capabilities.json"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateManifest = ajv.compile(schema);

if (!validateManifest(manifest)) {
  console.error(validateManifest.errors);
  process.exitCode = 1;
} else {
  const capabilities = new Map(
    manifest.capabilities.map((capability) => [capability.id, capability]),
  );
  const expectedImplemented = new Set([
    "page_views",
    "browser_context",
    "anonymous_visitors",
    "sessions",
    "dimensions",
    "custom_events",
    "web_vitals",
    "conversions",
    "funnels",
    "geo",
  ]);
  const expectedPlanned = new Set();
  const errors = [];

  if (capabilities.size !== 10) errors.push("manifest must contain exactly 10 unique capabilities");
  for (const capability of manifest.capabilities) {
    for (const dependency of capability.depends_on) {
      if (!capabilities.has(dependency))
        errors.push(`${capability.id} depends on unknown ${dependency}`);
    }
    if (capability.status === "planned") {
      if (capability.api.query_surface !== "future_report" || capability.api.routes.length > 0) {
        errors.push(`${capability.id} planned API must not expose runtime routes`);
      }
      if (capability.dashboard.surface !== "future_report") {
        errors.push(`${capability.id} planned Dashboard surface must be future_report`);
      }
    }
    const expectedSet = capability.status === "implemented" ? expectedImplemented : expectedPlanned;
    if (!expectedSet.has(capability.id)) {
      errors.push(`${capability.id} has an unexpected PR1 status`);
    }
  }

  for (const id of findDependencyCycles(capabilities)) {
    errors.push(`capability dependency cycle includes ${id}`);
  }

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Capability manifest validated successfully.");
  }
}

const cycleTest = findDependencyCycles(
  new Map([
    ["a", { depends_on: ["b"] }],
    ["b", { depends_on: ["a"] }],
  ]),
);
if (cycleTest.length === 0) {
  console.error("Capability dependency cycle test did not detect a cycle");
  process.exitCode = 1;
} else {
  console.log("PASS dependency-cycle detection");
}

const capabilitySchema = schema.$defs.capability;
const fixtureValidator = new Ajv2020({ allErrors: true, strict: true }).compile(capabilitySchema);
const manifestById = new Map(
  manifest.capabilities.map((capability) => [capability.id, capability]),
);
const fixtureMatchesManifest = (fixture, filename) => {
  const canonical = manifestById.get(fixture.id);
  if (!canonical) return false;
  const boundaryMatches =
    fixture.status === canonical.status &&
    JSON.stringify(fixture.depends_on) === JSON.stringify(canonical.depends_on) &&
    (fixture.status !== "planned" ||
      (fixture.api.query_surface === "future_report" &&
        fixture.api.routes.length === 0 &&
        fixture.dashboard.surface === "future_report"));
  if (!boundaryMatches) return false;
  return (
    !filename.startsWith("canonical-") || JSON.stringify(fixture) === JSON.stringify(canonical)
  );
};
for (const [directoryName, expectedValid] of [
  ["valid", true],
  ["invalid", false],
]) {
  const directory = path.join(capabilityRoot, "fixtures", directoryName);
  for (const filename of (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const fixture = await readJson(path.join(directory, filename));
    const structurallyValid = fixtureValidator(fixture);
    const actualValid = structurallyValid && fixtureMatchesManifest(fixture, filename);
    if (actualValid !== expectedValid) {
      console.error(`Capability fixture mismatch: ${path.join(directory, filename)}`);
      console.error(fixtureValidator.errors ?? "no validation details");
      process.exitCode = 1;
    } else {
      console.log(`${expectedValid ? "PASS" : "EXPECTED FAIL"} ${filename}`);
    }
  }
}
