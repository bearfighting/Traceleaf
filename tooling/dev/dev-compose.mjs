import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runNativeDevelopment } from "./native-rust.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeFiles = ["-f", "compose.yaml", "-f", "compose.backend.yaml", "-f", "compose.dev.yaml"];
const modeProfiles = {
  full: ["storage", "backend", "processing", "dashboard", "playground-next"],
  backend: ["storage", "backend", "playground-next"],
  processing: ["storage", "backend", "processing", "playground-next"],
};

export function parseSeedInitArgs(args) {
  let seedInit = false;
  let rustRuntime = "container";
  let runtimeSpecified = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--seed-init" || argument === "--seed") {
      if (seedInit) throw new Error("Specify only one of --seed-init or --seed.");
      seedInit = true;
      continue;
    }
    let runtime;
    if (argument === "--rust-runtime") {
      runtime = args[++index];
      if (!runtime || runtime.startsWith("--")) {
        throw new Error("--rust-runtime requires container or native.");
      }
    } else if (argument.startsWith("--rust-runtime=")) {
      runtime = argument.slice("--rust-runtime=".length);
    }
    if (runtime !== undefined) {
      if (runtimeSpecified) throw new Error("Specify --rust-runtime only once.");
      if (runtime !== "container" && runtime !== "native") {
        throw new Error(`Unknown Rust runtime '${runtime}'; use container or native.`);
      }
      rustRuntime = runtime;
      runtimeSpecified = true;
      continue;
    }
    throw new Error(`Unknown development Compose argument '${argument}'.`);
  }
  return { seedInit, rustRuntime };
}

export function buildSeedComposeArgs() {
  return [...composeFiles, "--profile", "storage", "run", "--build", "--rm", "dev-seed"];
}

export function buildUpComposeArgs(mode) {
  const profiles = modeProfiles[mode];
  if (!profiles) throw new Error(`Unknown development Compose mode '${mode}'.`);
  return buildProfileUpComposeArgs(profiles);
}

export function buildProfileUpComposeArgs(profiles, { developmentOverlay = true } = {}) {
  return [
    "-f",
    "compose.yaml",
    ...(developmentOverlay ? ["-f", "compose.backend.yaml", "-f", "compose.dev.yaml"] : []),
    ...profiles.flatMap((profile) => ["--profile", profile]),
    "up",
    "--build",
    "--wait",
  ];
}

export function runSeedIfRequested(seedInit, { spawnSyncImpl = spawnSync } = {}) {
  if (!seedInit) return 0;
  const result = spawnSyncImpl("docker", ["compose", ...buildSeedComposeArgs()], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function startDevelopmentCompose(mode, { spawnImpl = spawn, env = process.env } = {}) {
  const child = spawnImpl("docker", ["compose", ...buildUpComposeArgs(mode)], {
    cwd: root,
    stdio: "inherit",
    env,
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
}

export function startProfileCompose(
  profiles,
  { developmentOverlay = true, env = process.env, spawnImpl = spawn } = {},
) {
  const child = spawnImpl(
    "docker",
    ["compose", ...buildProfileUpComposeArgs(profiles, { developmentOverlay })],
    {
      cwd: root,
      stdio: "inherit",
      env,
    },
  );
  child.on("error", (error) => {
    console.error(`Failed to start Docker Compose: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

export function runDevelopmentMode(
  mode,
  args,
  { spawnSyncImpl = spawnSync, spawnImpl = spawn, env = process.env } = {},
) {
  let parsed;
  try {
    parsed = parseSeedInitArgs(args);
  } catch (error) {
    const command = { full: "dev:up", backend: "docker:backend", processing: "docker:processing" }[
      mode
    ];
    console.error(
      `${error.message}\nUsage: pnpm ${command} [--seed-init|--seed] [--rust-runtime container|native]`,
    );
    process.exit(2);
  }

  const composeVersion = spawnSyncImpl("docker", ["compose", "version"], { stdio: "ignore" });
  if (composeVersion.status !== 0) {
    console.error("Docker Compose v2 is required. Use the 'docker compose' command.");
    process.exit(1);
  }

  try {
    const seedStatus = runSeedIfRequested(parsed.seedInit, { spawnSyncImpl });
    if (seedStatus !== 0) process.exit(seedStatus);
  } catch (error) {
    console.error(`Failed to initialize the local development Site: ${error.message}`);
    process.exit(1);
  }
  if (parsed.rustRuntime === "native") {
    runNativeDevelopment(mode).then((status) => {
      process.exitCode = status;
    });
  } else {
    startDevelopmentCompose(mode, { spawnImpl, env });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDevelopmentMode(process.argv[2], process.argv.slice(3));
}
