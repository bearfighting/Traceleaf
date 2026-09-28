import { spawn, spawnSync } from "node:child_process";
import { parseDockerArgs, RouterArgumentError } from "./router-targets.mjs";

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

const profiles = [parsed.target.profile];
if (parsed.withBackend) profiles.push("backend", "storage", "processing");
const composeArgs = ["-f", "compose.yaml"];
if (parsed.withBackend) composeArgs.push("-f", "compose.backend.yaml", "-f", "compose.dev.yaml");
composeArgs.push(...profiles.flatMap((profile) => ["--profile", profile]));
composeArgs.push("up", "--build", "--wait");

const composeEnvironment = { ...process.env };
if (!parsed.withBackend) composeEnvironment.NEXT_PUBLIC_ANALYTICS_TRANSPORT = "mock";

const child = spawn("docker", ["compose", ...composeArgs], {
  stdio: "inherit",
  env: composeEnvironment,
});
child.on("error", (error) => {
  console.error(`Failed to start Docker Compose: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
