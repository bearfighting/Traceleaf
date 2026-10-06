import { spawnSync } from "node:child_process";
import { parseDockerArgs, RouterArgumentError } from "./router-targets.mjs";
import { runSeedIfRequested, startProfileCompose } from "./dev-compose.mjs";

let parsed;
try {
  parsed = parseDockerArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof RouterArgumentError ? error.message : String(error));
  process.exit(2);
}

if (spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status !== 0) {
  console.error("Docker Compose v2 is required. Use the 'docker compose' command.");
  process.exit(1);
}

if (parsed.withBackend && parsed.seedInit) {
  try {
    const seedStatus = runSeedIfRequested(true);
    if (seedStatus !== 0) process.exit(seedStatus);
  } catch (error) {
    console.error(`Failed to initialize the local development Site: ${error.message}`);
    process.exit(1);
  }
}

const profiles = parsed.withBackend
  ? [parsed.target.profile, "backend", "storage", "processing"]
  : [parsed.target.profile];
const environment = parsed.withBackend
  ? process.env
  : { ...process.env, NEXT_PUBLIC_ANALYTICS_TRANSPORT: "mock" };
startProfileCompose(profiles, { developmentOverlay: parsed.withBackend, env: environment });
