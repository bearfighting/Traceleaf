import { spawn, spawnSync } from "node:child_process";
import { parseDevArgs, RouterArgumentError } from "./router-targets.mjs";

let parsed;
try {
  parsed = parseDevArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof RouterArgumentError ? error.message : String(error));
  process.exit(2);
}

const build = spawnSync("pnpm", ["build:packages"], { stdio: "inherit" });
if (build.error) {
  console.error(`Failed to build workspace packages: ${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const child = spawn("pnpm", ["--filter", parsed.target.packageName, "dev", ...parsed.passthrough], {
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start ${parsed.target.packageName}: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
