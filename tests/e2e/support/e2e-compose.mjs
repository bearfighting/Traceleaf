/* global fetch, process, setTimeout */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function createE2EComposeRunner({
  root,
  project,
  files = ["compose.yaml", "compose.backend.yaml", "compose.e2e.yaml"],
  profiles = [],
  env = {},
}) {
  assertE2EProject(project);
  const composeArgs = [
    "compose",
    "-p",
    project,
    ...files.flatMap((file) => ["-f", file]),
    ...profiles.flatMap((profile) => ["--profile", profile]),
  ];

  function runCompose(
    args,
    { capture = false, allowFailure = false, env: envOverrides = {} } = {},
  ) {
    try {
      return execFileSync("docker", [...composeArgs, ...args], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, ...env, ...envOverrides },
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      });
    } catch (error) {
      const output = [error.stdout ?? "", error.stderr ?? ""].filter(Boolean).join("\n");
      if (allowFailure) return output;

      const status = error.status == null ? "unknown" : String(error.status);
      throw new Error(
        `docker compose ${args.join(" ")} failed (exit code: ${status})${output ? `:\n${output}` : ""}`,
        { cause: error },
      );
    }
  }

  Object.defineProperty(runCompose, "e2eProject", { value: project });
  Object.defineProperty(runCompose, "e2eSecrets", {
    value: Object.entries({ ...process.env, ...env })
      .filter(
        ([name, value]) =>
          /TOKEN|PASSWORD|DATABASE_URL|INGEST_KEY/.test(name) && typeof value === "string",
      )
      .map(([, value]) => value),
  });
  return { composeArgs, runCompose };
}

export function migrateE2EDatabase(runCompose) {
  assertE2EComposeRunner(runCompose);
  return runCompose(["run", "--rm", "--build", "db-migrate"]);
}

export function removeE2EComposeProject(runCompose) {
  assertE2EComposeRunner(runCompose);
  return runCompose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
}

export function assertE2EProject(project) {
  if (
    typeof project !== "string" ||
    !/^web-analytics-(?:[a-z0-9-]+-e2e|e2e|router-compose)-[a-z0-9]+$/.test(project)
  ) {
    throw new Error(`Refusing database or Compose operations for non-E2E project '${project}'.`);
  }
}

export function assertE2EComposeRunner(runCompose) {
  if (typeof runCompose !== "function") {
    throw new TypeError("runCompose must be an E2E Compose runner function.");
  }
  assertE2EProject(runCompose.e2eProject);
}

export async function waitForHttpService(
  label,
  url,
  { timeoutMs = 300_000, intervalMs = 500, isReady = (response) => response.ok } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await isReady(await fetch(url))) return;
    } catch {
      // The service may still be starting or compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

export function e2ePort(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer TCP port.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return String(port);
}

export async function captureE2EComposeDiagnostics({
  runCompose,
  artifactDirectory,
  services,
  includeConfig = true,
  transformConfig = (config) => config,
  configOptions = {},
}) {
  assertE2EComposeRunner(runCompose);
  await mkdir(artifactDirectory, { recursive: true });
  const redact = (value) =>
    runCompose.e2eSecrets.reduce(
      (output, secret) => output.split(secret).join("[REDACTED]"),
      value,
    );
  if (includeConfig) {
    await writeFile(
      path.join(artifactDirectory, "compose-config.txt"),
      redact(
        transformConfig(
          runCompose(["config"], { capture: true, allowFailure: true, ...configOptions }),
        ),
      ),
    );
  }
  await writeFile(
    path.join(artifactDirectory, "compose-ps.txt"),
    redact(runCompose(["ps", "--all"], { capture: true, allowFailure: true })),
  );
  await writeFile(
    path.join(artifactDirectory, "service-logs.txt"),
    redact(runCompose(["logs", "--no-color", ...services], { capture: true, allowFailure: true })),
  );
}
