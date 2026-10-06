#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractRoot = path.join(root, "protocol/contracts/configuration/current");
const fixtures = path.join(contractRoot, "fixtures");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const validators = new Map();
function compile(name) {
  if (!validators.has(name))
    validators.set(name, ajv.compile(readJson(path.join(contractRoot, name))));
  return validators.get(name);
}

const contracts = [
  ["environment-policy.schema.json", "environment-policy"],
  ["capabilities.schema.json", "capabilities"],
  ["environment-policy-update.schema.json", "environment-policy-update"],
  ["capability-update.schema.json", "capability-update"],
  [
    "conversion-funnel-definition-set-update.schema.json",
    "conversion-funnel-definition-set-update",
  ],
];
const failures = [];
let checked = 0;
const semantic = new Set([
  "capabilities/invalid/missing-dependency.json",
  "capabilities/invalid/page-views-disabled.json",
  "conversion-funnel-definition-set-update/invalid/duplicate-ids.json",
]);

for (const [schemaName, fixtureName] of contracts) {
  const validate = compile(schemaName);
  for (const [kind, expected] of [
    ["valid", true],
    ["invalid", false],
  ]) {
    const directory = path.join(fixtures, fixtureName, kind);
    for (const name of readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .sort()) {
      const file = path.join(directory, name);
      const accepted = Boolean(validate(readJson(file)));
      const relative = `${fixtureName}/${kind}/${name}`;
      const schemaExpected = kind === "valid" || semantic.has(relative);
      checked += 1;
      if (accepted !== schemaExpected)
        failures.push(`${relative}: expected Schema ${schemaExpected}, got ${accepted}`);
      if (semantic.has(relative))
        console.log(`SEMANTIC_FIXTURE\t${relative}\tSchema accepts; service test rejects`);
    }
  }
}

// Candidate assertions are deliberately distinct from current production behavior.
const policy = compile("environment-policy.schema.json");
const capability = compile("capabilities.schema.json");
const candidates = [
  [
    "environment-policy/invalid/invalid-updated-at-date-time.json",
    readJson(path.join(fixtures, "environment-policy/invalid/invalid-updated-at-date-time.json")),
    policy,
  ],
  [
    "environment-policy/invalid/invalid-key-created-at-date-time.json",
    readJson(
      path.join(fixtures, "environment-policy/invalid/invalid-key-created-at-date-time.json"),
    ),
    policy,
  ],
  [
    "capabilities/invalid/invalid-updated-at-date-time.json",
    readJson(path.join(fixtures, "capabilities/invalid/invalid-updated-at-date-time.json")),
    capability,
  ],
];
for (const [name, document, validate] of candidates) {
  checked += 1;
  if (validate(document)) failures.push(`${name}: strict Schema candidate unexpectedly accepted`);
}

// Schema integers are unbounded; these probes document the i64 consumer boundary.
const validPolicy = readJson(
  path.join(fixtures, "environment-policy/valid/empty-ingest-keys.json"),
);
for (const [field, value] of [
  ["version", 1e30],
  ["rate_limit_per_minute", 1e30],
]) {
  const document = { ...validPolicy, [field]: value };
  const accepts = Boolean(policy(document));
  console.log(
    `INTEGER_RANGE\t${field}\t${accepts ? "schema-accepts" : "schema-rejects-js-number"}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL\t${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `configuration Schema fixture parity passed (${checked} cases; semantic rules remain consumer-specific)`,
  );
}
