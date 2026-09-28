import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareE2ECaches } from "./e2e-cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `web-analytics-router-compose-${process.pid}`;
const port = process.env.ROUTER_COMPOSE_PORT ?? "13101";
const postgresPort = process.env.ROUTER_COMPOSE_POSTGRES_PORT ?? "15433";
const collectorPort = process.env.ROUTER_COMPOSE_COLLECTOR_PORT ?? "14003";
const analyticsApiPort = process.env.ROUTER_COMPOSE_ANALYTICS_API_PORT ?? "14004";
const compose = [
  "compose",
  "-p",
  project,
  "-f",
  "compose.yaml",
  "-f",
  "compose.backend.yaml",
  "-f",
  "compose.e2e.yaml",
  "--profile",
  "playground-react",
  "--profile",
  "backend",
  "--profile",
  "storage",
  "--profile",
  "processing",
];

function runCompose(args) {
  return execFileSync("docker", [...compose, ...args], {
    cwd: root,
    env: {
      ...process.env,
      PLAYGROUND_REACT_PORT: port,
      E2E_POSTGRES_PORT: postgresPort,
      E2E_COLLECTOR_PORT: collectorPort,
      E2E_ANALYTICS_API_PORT: analyticsApiPort,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
}

try {
  prepareE2ECaches(root, "router-compose");
  runCompose(["up", "-d", "--build", "--wait", "playground-react"]);
  await waitFor(`http://127.0.0.1:${port}/`);
  console.log("Router Compose backend smoke test passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    runCompose(["down", "--volumes", "--remove-orphans"]);
  } catch {
    // Preserve the original smoke-test failure while still attempting cleanup.
  }
}

async function waitFor(url) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The playground is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Router Compose playground did not become ready at ${url}`);
}
