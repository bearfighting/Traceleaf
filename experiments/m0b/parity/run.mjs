import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifacts = path.join(root, "artifacts/m0b-parity");
await mkdir(artifacts, { recursive: true });

const compiled = spawnSync(
  "pnpm",
  [
    "exec",
    "tsc",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2022",
    "--module",
    "ES2022",
    "--moduleResolution",
    "Bundler",
    "--outDir",
    path.join(artifacts, "typescript"),
    path.join(root, "experiments/m0b/parity/typescript/static-validator.ts"),
  ],
  { cwd: root, encoding: "utf8" },
);
if (compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout);

const rust = spawnSync(
  "cargo",
  ["run", "--offline", "--locked", "--manifest-path", "experiments/m0b/parity/rust/Cargo.toml"],
  { cwd: root, encoding: "utf8" },
);
if (rust.status !== 0) throw new Error(rust.stderr || rust.stdout);
const rustResults = new Map(
  rust.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const result = JSON.parse(line);
      return [result.key, result];
    }),
);
const policyTest = spawnSync(
  "cargo",
  [
    "test",
    "-p",
    "collector",
    "canonical_policy_fixtures_match_runtime_parser",
    "--",
    "--nocapture",
  ],
  { cwd: root, encoding: "utf8" },
);
if (policyTest.status !== 0) throw new Error(policyTest.stderr || policyTest.stdout);
const collectorPolicyResults = new Map(
  [
    ...policyTest.stdout.matchAll(
      /M0B_POLICY_COLLECTOR_RESULT\t(valid|invalid)\t([^\t\n]+)\t(true|false)/g,
    ),
  ].map(([, validity, filename, accepted]) => [
    `environment-policy/fixtures/${validity}/${filename}`,
    accepted === "true",
  ]),
);
await writeFile(path.join(artifacts, "typescript/package.json"), '{"type":"module"}\n');

const eventRoot = path.join(root, "protocol/events");
const policyRoot = path.join(root, "protocol/contracts/configuration/current");
const eventSchemas = await Promise.all(
  ["page-view-event", "custom-event", "web-vital-event", "event-batch"].map((name) =>
    readJson(path.join(eventRoot, "schemas", `${name}.schema.json`)),
  ),
);
const contextSchema = await readJson(
  path.join(root, "protocol/contexts/browser-context.schema.json"),
);
const policySchema = await readJson(path.join(policyRoot, "environment-policy.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of [...eventSchemas.slice(0, 3), contextSchema]) ajv.addSchema(schema);
const schemaValidators = {
  page_view: ajv.compile(eventSchemas[0]),
  custom_event: ajv.compile(eventSchemas[1]),
  web_vital: ajv.compile(eventSchemas[2]),
  batch: ajv.compile(eventSchemas[3]),
  policy: new Ajv2020({ allErrors: true, strict: true }),
};
addFormats(schemaValidators.policy);
schemaValidators.policy = schemaValidators.policy.compile(policySchema);

const tsModule = await import(
  pathToFileURL(path.join(artifacts, "typescript/static-validator.js")).href
);
const rows = [];
for (const [sample, directory, kind] of [
  ["events", path.join(eventRoot, "fixtures"), "event"],
  ["environment-policy", path.join(policyRoot, "fixtures/environment-policy"), "policy"],
]) {
  for (const validity of ["valid", "invalid"]) {
    const fixtureDirectory = path.join(directory, validity);
    for (const filename of (await readdir(fixtureDirectory))
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const value = await readJson(path.join(fixtureDirectory, filename));
      const key = `${sample}/${validity}/${filename}`;
      const standaloneEvent = kind === "event" && typeof value.type === "string";
      const schemaValidator =
        kind === "policy"
          ? schemaValidators.policy
          : standaloneEvent
            ? (schemaValidators[value.type] ?? (() => false))
            : schemaValidators.batch;
      const schema = schemaValidator(value);
      const ts =
        kind === "policy"
          ? tsModule.validatePolicy(value)
          : standaloneEvent
            ? tsModule.validateEvent(value)
            : tsModule.validateEventBatch(value);
      const rustResult = rustResults.get(key);
      if (!rustResult) throw new Error(`Rust parity output missing ${key}`);
      const expected = validity === "valid";
      if (ts !== expected || rustResult.static !== expected) {
        throw new Error(
          `Static parity mismatch for ${key}: expected=${expected}, ts=${ts}, rust=${rustResult.static}`,
        );
      }
      const collector =
        kind === "policy"
          ? collectorPolicyResults.get(`environment-policy/fixtures/${validity}/${filename}`)
          : rustResult.collector;
      if (collector === undefined) throw new Error(`Collector result missing ${key}`);
      rows.push({
        key,
        expected,
        schema,
        typescript: ts,
        rust: rustResult.static,
        typifySerde: kind === "policy" ? rustResult.typify_serde : null,
        collector,
        serializedSchema: { typescript: null, rust: null },
      });
      if (
        ts &&
        !schemaValidatorsForValue(value, schemaValidators)(JSON.parse(JSON.stringify(value)))
      ) {
        rows.at(-1).serializedSchema.typescript = false;
      } else if (ts) {
        rows.at(-1).serializedSchema.typescript = true;
      }
      if (rustResult.serialized !== null) {
        rows.at(-1).serializedSchema.rust = schemaValidatorsForValue(
          rustResult.serialized,
          schemaValidators,
        )(rustResult.serialized);
      }
    }
  }
}

const output = {
  generatedAt: "reproducible",
  counts: {
    fixtures: rows.length,
    mismatches: rows.filter(
      (row) => new Set([row.schema, row.typescript, row.rust, row.collector]).size > 1,
    ).length,
    schemaVsExpected: rows.filter((row) => row.schema !== row.expected).length,
    typescriptStaticVsExpected: rows.filter((row) => row.typescript !== row.expected).length,
    rustStaticVsExpected: rows.filter((row) => row.rust !== row.expected).length,
    collectorCurrentVsExpected: rows.filter((row) => row.collector !== row.expected).length,
    typifySerdeVsExpected: rows.filter(
      (row) => typeof row.typifySerde === "boolean" && row.typifySerde !== row.expected,
    ).length,
    rustSerializedSchemaRejected: rows.filter(
      (row) => row.expected && row.serializedSchema.rust === false,
    ).length,
  },
  results: rows,
};
await writeFile(path.join(artifacts, "results.json"), `${JSON.stringify(output, null, 2)}\n`);
const tsv = [
  "fixture\texpected\tschema\ttypescript_static\trust_static\ttypify_serde\tcollector_current\tts_serialized_schema\trust_serialized_schema",
  ...rows.map((row) =>
    [
      row.key,
      row.expected,
      row.schema,
      row.typescript,
      row.rust,
      row.typifySerde,
      row.collector,
      row.serializedSchema.typescript,
      row.serializedSchema.rust ?? "null",
    ].join("\t"),
  ),
].join("\n");
await writeFile(path.join(artifacts, "results.tsv"), `${tsv}\n`);
await writeFile(path.join(root, "docs/archive/development/m0b-step6-parity-matrix.tsv"), `${tsv}\n`);
console.log(
  `M0b parity: ${rows.length} fixtures; ${output.counts.mismatches} cross-lane differences; ` +
    `${output.counts.collectorCurrentVsExpected} Collector-current and ${output.counts.typifySerdeVsExpected} typify-Serde expectation differences.`,
);
console.log(path.join(artifacts, "results.tsv"));

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function schemaValidatorsForValue(value, validators) {
  if (value && typeof value === "object" && "type" in value)
    return validators[value.type] ?? (() => false);
  if (value && typeof value === "object" && "schema_version" in value && "events" in value)
    return validators.batch;
  return validators.policy;
}
