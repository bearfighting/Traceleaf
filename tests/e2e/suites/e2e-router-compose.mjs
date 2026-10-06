import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareE2ECaches } from "../support/e2e-cache.mjs";
import {
  createE2EComposeRunner,
  e2ePort,
  removeE2EComposeProject,
  waitForHttpService,
} from "../support/e2e-compose.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const project = `web-analytics-router-compose-${process.pid}`;
const port = e2ePort("ROUTER_COMPOSE_PORT", 13101);
const postgresPort = e2ePort("ROUTER_COMPOSE_POSTGRES_PORT", 15433);
const collectorPort = e2ePort("ROUTER_COMPOSE_COLLECTOR_PORT", 14003);
const analyticsApiPort = e2ePort("ROUTER_COMPOSE_ANALYTICS_API_PORT", 14004);
const { runCompose } = createE2EComposeRunner({
  root,
  project,
  profiles: ["playground-react", "backend", "storage", "processing"],
  env: {
    PLAYGROUND_REACT_PORT: port,
    E2E_POSTGRES_PORT: postgresPort,
    E2E_COLLECTOR_PORT: collectorPort,
    E2E_ANALYTICS_API_PORT: analyticsApiPort,
  },
});

try {
  prepareE2ECaches(root, "router-compose");
  runCompose(["up", "-d", "--build", "--wait", "playground-react"]);
  await waitForHttpService(`Router Compose playground`, `http://127.0.0.1:${port}/`, {
    timeoutMs: 180_000,
    intervalMs: 250,
  });
  console.log("Router Compose backend smoke test passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  removeE2EComposeProject(runCompose);
}
