/* global console, process */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [suite, command, ...args] = process.argv.slice(2);

if (!suite || !command) {
  console.error("Usage: node scripts/measure-ci-e2e.mjs <suite> <command> [args...]");
  process.exit(2);
}

const artifactDirectory = path.join(root, "artifacts", "ci-docker-cache", suite);
const logPath = path.join(artifactDirectory, "e2e-build.log");
const summaryPath = path.join(artifactDirectory, "measurement.json");

await mkdir(artifactDirectory, { recursive: true });

function defaultRouteInterface() {
  const result = spawnSync("ip", ["-o", "route", "show", "default"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.match(/\bdev\s+(\S+)/)?.[1] ?? null;
}

async function receivedBytes(networkInterface) {
  if (!networkInterface) return null;
  try {
    return Number(
      (await readFile(`/sys/class/net/${networkInterface}/statistics/rx_bytes`, "utf8")).trim(),
    );
  } catch {
    return null;
  }
}

const networkInterface = defaultRouteInterface();
const bytesBefore = await receivedBytes(networkInterface);
const startedAt = new Date();
const started = process.hrtime.bigint();
const log = createWriteStream(logPath, { flags: "w" });
const child = spawn(command, args, {
  cwd: root,
  env: { ...process.env, COMPOSE_PROGRESS: "plain" },
  stdio: ["inherit", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
}

const exitCode = await new Promise((resolve) => {
  child.on("error", (error) => {
    const message = `${error.message}\n`;
    process.stderr.write(message);
    log.write(message);
    resolve(127);
  });
  child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
});

await new Promise((resolve) => log.end(resolve));
const finishedAt = new Date();
const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
const bytesAfter = await receivedBytes(networkInterface);
const summary = {
  suite,
  command: [command, ...args],
  started_at: startedAt.toISOString(),
  finished_at: finishedAt.toISOString(),
  elapsed_seconds: Number(elapsedSeconds.toFixed(3)),
  exit_code: exitCode,
  network_interface: networkInterface,
  received_bytes_before: bytesBefore,
  received_bytes_after: bytesAfter,
  received_bytes_delta:
    bytesBefore === null || bytesAfter === null ? null : Math.max(0, bytesAfter - bytesBefore),
  received_bytes_note:
    "Approximate total runner ingress during the E2E command; includes non-Docker traffic.",
};

await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `E2E measurement: ${summary.elapsed_seconds}s; ingress delta: ${summary.received_bytes_delta ?? "unavailable"} bytes`,
);
process.exitCode = exitCode;
