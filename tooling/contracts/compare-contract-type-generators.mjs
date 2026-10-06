import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const samples = {
  event: {
    file: "protocol/events/schemas/event-batch.schema.json",
    name: "EventBatchV1",
  },
  policy: {
    file: "protocol/contracts/configuration/current/environment-policy.schema.json",
    name: "StoredEnvironmentPolicyV1",
  },
};

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const toolkitRoot = argument("--toolkit-root");
const json2tsRoot = argument("--json2ts-root");
const typifyBin = argument("--typify-bin");
const outputArgument = argument("--output-dir");
const sampleDirectory = resolve(
  repositoryRoot,
  argument("--sample-dir", "experiments/m0b/generated"),
);
const check = process.argv.includes("--check");
const snapshot = process.argv.includes("--snapshot");

if (!toolkitRoot || !json2tsRoot || !typifyBin || !outputArgument) {
  throw new Error(
    "Required: --toolkit-root PATH --json2ts-root PATH --typify-bin PATH --output-dir PATH",
  );
}
if (check && snapshot) throw new Error("Use either --check or --snapshot");

const pinnedToolkitCommit = "825f4398e125f586354a18ba575d4d37edc5c745";
const pinnedToolkitVersion = "0.7.0";
const pinnedJson2tsVersion = "16.0.0";
const pinnedTypifyVersion = "0.8.0";
const typifyExecutable = isAbsolute(typifyBin) ? typifyBin : resolve(repositoryRoot, typifyBin);
const toolkitVersion = JSON.parse(
  readFileSync(join(resolve(toolkitRoot), "packages/sdk/package.json"), "utf8"),
).version;
const json2tsVersion = JSON.parse(
  readFileSync(
    join(resolve(json2tsRoot), "node_modules/json-schema-to-typescript/package.json"),
    "utf8",
  ),
).version;
const toolkitCommitRun = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: resolve(toolkitRoot),
  encoding: "utf8",
});
const typifyVersionRun = spawnSync(typifyExecutable, ["typify", "--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
if (
  toolkitVersion !== pinnedToolkitVersion ||
  toolkitCommitRun.status !== 0 ||
  toolkitCommitRun.stdout.trim() !== pinnedToolkitCommit ||
  json2tsVersion !== pinnedJson2tsVersion ||
  typifyVersionRun.status !== 0 ||
  typifyVersionRun.stdout.trim() !== `cargo-typify ${pinnedTypifyVersion}`
) {
  throw new Error("Generator versions differ from the pinned trial versions");
}

const outputDirectory = resolve(repositoryRoot, outputArgument);
if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
  throw new Error(`Output directory must be empty: ${outputDirectory}`);
}
mkdirSync(outputDirectory, { recursive: true });
const generatedDirectory = join(outputDirectory, "generated");
const diagnosticDirectory = join(outputDirectory, "diagnostics");
mkdirSync(generatedDirectory);
mkdirSync(diagnosticDirectory);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const inputFiles = Object.fromEntries(
  Object.entries(samples).map(([key, value]) => {
    const file = resolve(repositoryRoot, value.file);
    return [key, { ...value, absoluteFile: file, sha256: sha256(file) }];
  }),
);

// Stage the unchanged files under the path hierarchy declared by their $id values.
// The source page-view $ref is relative to its $id, not its repository file path.
const stage = join(outputDirectory, "stage", "schemas");
mkdirSync(join(stage, "events"), { recursive: true });
mkdirSync(join(stage, "contexts"), { recursive: true });
for (const name of ["event-batch", "page-view-event", "custom-event", "web-vital-event"]) {
  const source = resolve(repositoryRoot, `protocol/events/schemas/${name}.schema.json`);
  const target = join(stage, "events", `${name}.schema.json`);
  copyFileSync(source, target);
  if (sha256(source) !== sha256(target)) throw new Error(`Staged file changed: ${name}`);
}
const contextSource = resolve(repositoryRoot, "protocol/contexts/browser-context.schema.json");
const contextTarget = join(stage, "contexts", "browser-context.schema.json");
copyFileSync(contextSource, contextTarget);
if (sha256(contextSource) !== sha256(contextTarget)) throw new Error("Staged context changed");

function localizeReferences(node, replacements) {
  if (Array.isArray(node)) return node.map((item) => localizeReferences(item, replacements));
  if (node === null || typeof node !== "object") return node;
  const localized = {};
  for (const [key, value] of Object.entries(node)) {
    // Every embedded source declares the same 2020-12 dialect as the root.
    if (key === "$id" || key === "$schema") continue;
    if (key === "$ref") {
      if (!Object.hasOwn(replacements, value)) {
        throw new Error("Unmapped schema reference: " + value);
      }
      localized[key] = replacements[value];
    } else {
      localized[key] = localizeReferences(value, replacements);
    }
  }
  return localized;
}

const bundledEventFile = join(outputDirectory, "stage", "event-batch-bundled.schema.json");
const originalBatch = readJson(inputFiles.event.absoluteFile);
const bundledEvent = localizeReferences(originalBatch, {
  "page-view-event.schema.json": "#/$defs/pageView",
  "custom-event.schema.json": "#/$defs/customEvent",
  "web-vital-event.schema.json": "#/$defs/webVital",
});
bundledEvent.$id = originalBatch.$id;
bundledEvent.$defs = {
  pageView: localizeReferences(
    readJson(resolve(repositoryRoot, "protocol/events/schemas/page-view-event.schema.json")),
    { "../contexts/browser-context.schema.json": "#/$defs/browserContext" },
  ),
  customEvent: localizeReferences(
    readJson(resolve(repositoryRoot, "protocol/events/schemas/custom-event.schema.json")),
    {},
  ),
  webVital: localizeReferences(
    readJson(resolve(repositoryRoot, "protocol/events/schemas/web-vital-event.schema.json")),
    {},
  ),
  browserContext: localizeReferences(readJson(contextSource), {
    "#/$defs/unknownOrDimension": "#/$defs/browserContextUnknownOrDimension",
  }),
  browserContextUnknownOrDimension: readJson(contextSource).$defs.unknownOrDimension,
};
writeFileSync(bundledEventFile, JSON.stringify(bundledEvent, null, 2) + "\n");

function eventValidator(schema, referencedSchemas = []) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const reference of referencedSchemas) ajv.addSchema(reference);
  return ajv.compile(schema);
}
const referencedEvents = ["page-view-event", "custom-event", "web-vital-event"].map((name) =>
  readJson(resolve(repositoryRoot, `protocol/events/schemas/${name}.schema.json`)),
);
const originalValidator = eventValidator(readJson(inputFiles.event.absoluteFile), [
  ...referencedEvents,
  readJson(contextSource),
]);
const bundledValidator = eventValidator(bundledEvent);
let comparedFixtures = 0;
for (const validity of ["valid", "invalid"]) {
  const fixtureDirectory = resolve(repositoryRoot, `protocol/events/fixtures/${validity}`);
  for (const filename of readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json"))) {
    const fixture = readJson(join(fixtureDirectory, filename));
    const batch = Object.hasOwn(fixture, "type")
      ? { schema_version: 1, events: [fixture] }
      : fixture;
    if (originalValidator(batch) !== bundledValidator(batch)) {
      throw new Error(`Bundled event schema changed fixture result: ${validity}/${filename}`);
    }
    comparedFixtures += 1;
  }
}

const results = [];
function outputPath(tool, sample, extension) {
  const directory = join(generatedDirectory, tool);
  mkdirSync(directory, { recursive: true });
  return join(directory, `${sample}.${extension}`);
}
function diagnosticPath(tool, sample, extension) {
  return join(diagnosticDirectory, `${tool}-${sample}.${extension}`);
}
function summarize(tool, sample, language, status, detail) {
  results.push({ tool, sample, language, status, ...detail });
}

const sdkEntry = join(resolve(toolkitRoot), "packages/sdk/dist/index.js");
const { convert } = await import(pathToFileURL(sdkEntry).href);
for (const [sample, spec] of [
  ...Object.entries(inputFiles),
  ["event-bundled", { ...inputFiles.event, absoluteFile: bundledEventFile }],
]) {
  for (const language of ["typescript", "rust"]) {
    const result = convert({
      sourceFormat: "json-schema",
      targetFormat: language,
      input: readFileSync(spec.absoluteFile, "utf8"),
      name: spec.name,
      includeArtifacts: true,
    });
    const diagnostic = result.ok
      ? {
          diagnostics: result.diagnostics ?? [],
          semanticCaveats: result.report?.semanticCaveats ?? [],
          losses: result.report?.losses ?? [],
          lossHotspots: result.report?.lossHotspots ?? [],
        }
      : {
          phase: result.phase,
          code: result.code,
          message: result.message,
          diagnostics: result.diagnostics ?? [],
        };
    writeFileSync(
      diagnosticPath("toolkit", `${sample}-${language}`, "json"),
      `${JSON.stringify(diagnostic, null, 2)}\n`,
    );
    if (result.ok) {
      const file = outputPath("toolkit", sample, language === "rust" ? "rs" : "ts");
      writeFileSync(file, result.output);
      summarize("toolkit", sample, language, "generated", {
        caveats: diagnostic.semanticCaveats.length,
        losses: diagnostic.losses.length,
        sha256: sha256(file),
      });
    } else {
      summarize("toolkit", sample, language, "failed", {
        phase: result.phase,
        code: result.code,
      });
    }
  }
}

const json2tsCli = join(
  resolve(json2tsRoot),
  "node_modules/json-schema-to-typescript/dist/src/cli.js",
);
const rawEventRun = spawnSync(
  process.execPath,
  [
    json2tsCli,
    "--input",
    inputFiles.event.absoluteFile,
    "--output",
    outputPath("json2ts", "event-original", "ts"),
  ],
  { cwd: repositoryRoot, encoding: "utf8" },
);
writeFileSync(
  diagnosticPath("json2ts", "event-original", "txt"),
  `${rawEventRun.stdout ?? ""}${rawEventRun.stderr ?? ""}`,
);
summarize(
  "json2ts",
  "event-original",
  "typescript",
  rawEventRun.status === 0 ? "generated" : "failed",
  {
    exitCode: rawEventRun.status,
  },
);

for (const [sample, spec] of Object.entries(inputFiles)) {
  const input =
    sample === "event" ? join(stage, "events", "event-batch.schema.json") : spec.absoluteFile;
  const file = outputPath("json2ts", sample, "ts");
  const run = spawnSync(process.execPath, [json2tsCli, "--input", input, "--output", file], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  writeFileSync(diagnosticPath("json2ts", sample, "txt"), `${run.stdout ?? ""}${run.stderr ?? ""}`);
  if (run.status === 0 && existsSync(file)) {
    summarize("json2ts", sample, "typescript", "generated", { sha256: sha256(file) });
  } else {
    summarize("json2ts", sample, "typescript", "failed", {
      exitCode: run.status,
      error: run.error?.message,
    });
  }
}

for (const [sample, spec] of [
  ...Object.entries(inputFiles),
  ["event-bundled", { ...inputFiles.event, absoluteFile: bundledEventFile }],
]) {
  const file = outputPath("typify", sample, "rs");
  const run = spawnSync(
    typifyExecutable,
    ["typify", "--no-builder", "--output", file, spec.absoluteFile],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  writeFileSync(diagnosticPath("typify", sample, "txt"), `${run.stdout ?? ""}${run.stderr ?? ""}`);
  if (run.status === 0 && existsSync(file)) {
    summarize("typify", sample, "rust", "generated", { sha256: sha256(file) });
  } else {
    summarize("typify", sample, "rust", "failed", {
      exitCode: run.status,
      error: run.error?.message,
    });
  }
}

const manifest = {
  toolkitCommit: pinnedToolkitCommit,
  toolkitPackage: `@schema-transformation-toolkit/sdk@${pinnedToolkitVersion}`,
  json2tsPackage: `json-schema-to-typescript@${pinnedJson2tsVersion}`,
  typifyPackage: `cargo-typify@${pinnedTypifyVersion}`,
  inputs: Object.fromEntries(
    Object.entries(inputFiles).map(([name, spec]) => [
      name,
      { file: spec.file, sha256: spec.sha256 },
    ]),
  ),
  bundledEvent: { sha256: sha256(bundledEventFile), comparedFixtures },
  results,
};
const manifestFile = join(outputDirectory, "results.json");
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

if (snapshot) {
  mkdirSync(sampleDirectory, { recursive: true });
  for (const result of results.filter((item) => item.status === "generated")) {
    const extension = result.language === "rust" ? "rs" : "ts";
    const source = join(generatedDirectory, result.tool, `${result.sample}.${extension}`);
    const target = join(sampleDirectory, result.tool, `${result.sample}.${extension}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  copyFileSync(manifestFile, join(sampleDirectory, "results.json"));
}

if (check) {
  const failures = [];
  const referenceManifest = join(sampleDirectory, "results.json");
  if (!existsSync(referenceManifest) || sha256(referenceManifest) !== sha256(manifestFile)) {
    failures.push(referenceManifest);
  }
  for (const result of results.filter((item) => item.status === "generated")) {
    const extension = result.language === "rust" ? "rs" : "ts";
    const target = join(sampleDirectory, result.tool, `${result.sample}.${extension}`);
    if (!existsSync(target) || sha256(target) !== result.sha256) failures.push(target);
  }
  if (failures.length > 0) {
    console.error(`M0b generated samples are stale:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
}

for (const result of results) {
  console.log(
    `${result.tool}\t${result.sample}\t${result.language}\t${result.status}\t${result.code ?? result.exitCode ?? ""}`,
  );
}
console.log(`Results: ${manifestFile}`);
