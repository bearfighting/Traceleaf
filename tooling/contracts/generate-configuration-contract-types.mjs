import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageDirectory = join(root, "packages/protocol-ts");
const artifactRootIndex = process.argv.indexOf("--artifact-root");
if (artifactRootIndex !== -1 && !process.argv[artifactRootIndex + 1]) {
  throw new Error("--artifact-root requires a directory");
}
const artifactRoot = artifactRootIndex === -1 ? root : resolve(process.argv[artifactRootIndex + 1]);
const generatedTsDirectory = join(artifactRoot, "packages/protocol-ts/src/generated");
const generatedRustFile = join(
  artifactRoot,
  "services/collector/src/generated/environment_policy.rs",
);
const schemas = [
  ["environment-policy", "environment-policy.schema.json"],
  ["capabilities", "capabilities.schema.json"],
  ["capability-update", "capability-update.schema.json"],
  ["environment-policy-update", "environment-policy-update.schema.json"],
  [
    "conversion-funnel-definition-set-update",
    "conversion-funnel-definition-set-update.schema.json",
  ],
];
const schemaDirectory = "protocol/contracts/configuration/current";
const checking = process.argv.includes("--check");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "m2-configuration-types-"));

// json-schema-to-typescript emits {} for this schema; TS {} also admits non-object values.
function refineEmptySettings(schema, generated) {
  const settingsSchema = Object.values(schema.$defs ?? {})
    .map((definition) => definition.properties?.settings)
    .find(
      (property) =>
        property?.type === "object" &&
        property.maxProperties === 0 &&
        property.additionalProperties === false,
    );
  if (!settingsSchema) return generated;

  const matches = generated.match(/settings: \{\};/g) ?? [];
  if (matches.length !== 1) {
    throw new Error("Expected one generated empty settings object type");
  }
  return generated.replace("settings: {};", "settings: Record<string, never>;");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      [command, ...args].join(" ") + "\n" + (result.stdout ?? "") + (result.stderr ?? ""),
    );
  }
  return result.stdout ?? "";
}

function compareOrWrite(target, generated) {
  if (checking) {
    let current;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      throw new Error("Generated file is missing: " + target);
    }
    if (current !== generated) throw new Error("Generated file is stale: " + target);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, generated);
}

try {
  const tsPackage = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  if (tsPackage.devDependencies?.["json-schema-to-typescript"] !== "16.0.0") {
    throw new Error("json-schema-to-typescript must be pinned exactly to 16.0.0");
  }

  for (const [name, file] of schemas) {
    const input = "../../" + schemaDirectory + "/" + file;
    const output = join(temporaryDirectory, name + ".ts");
    const schemaPath = join(root, schemaDirectory, file);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    run("pnpm", [
      "--filter",
      "@web-analytics/protocol-ts",
      "exec",
      "json2ts",
      "-i",
      input,
      "-o",
      output,
      "--cwd",
      "../../" + schemaDirectory,
      "--unknownAny",
    ]);
    const generated = refineEmptySettings(schema, readFileSync(output, "utf8"));
    compareOrWrite(join(generatedTsDirectory, name + ".ts"), generated);
  }

  const typifyVersion = run("cargo-typify", ["typify", "--version"]).trim();
  if (typifyVersion !== "cargo-typify 0.8.0") {
    throw new Error("Expected cargo-typify 0.8.0, got " + typifyVersion);
  }
  const rustOutput = join(temporaryDirectory, "environment_policy.rs");
  run("cargo-typify", [
    "typify",
    "--no-builder",
    "--output",
    rustOutput,
    join(root, schemaDirectory, "environment-policy.schema.json"),
  ]);
  run("rustfmt", ["--edition", "2024", rustOutput]);
  compareOrWrite(generatedRustFile, readFileSync(rustOutput, "utf8"));

  console.log(
    checking
      ? "M2.3 generated TypeScript and Rust artifacts are up to date."
      : "Generated M2.3 TypeScript and Rust artifacts.",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
