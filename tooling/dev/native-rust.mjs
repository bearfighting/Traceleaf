import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeFiles = ["-f", "compose.yaml", "-f", "compose.backend.yaml", "-f", "compose.dev.yaml"];
const composeProfiles = ["storage", "backend", "processing", "dashboard", "playground-next"];
const rustPackages = ["collector", "processor", "analytics-api"];

export function nativeComposeArgs(mode) {
  const services = mode === "full" ? ["dashboard", "playground-next"] : ["playground-next"];
  return [...composeFiles, "up", "--detach", "--build", "--no-deps", ...services];
}

export function nativeServiceNames(mode) {
  return mode === "backend" ? ["collector"] : ["collector", "processor", "analytics-api"];
}

export async function runNativeDevelopment(
  mode,
  { spawnImpl = spawn, spawnSyncImpl = spawnSync } = {},
) {
  const services = nativeServiceNames(mode);
  const composeEnvironment = {
    ...process.env,
    DASHBOARD_ANALYTICS_API_URL: "http://host.docker.internal:4002",
    DASHBOARD_SITE_MANAGEMENT_API_URL: "http://host.docker.internal:4002",
  };
  const compose = (args, options = {}) =>
    spawnSyncImpl(
      "docker",
      [
        "compose",
        ...composeFiles,
        ...composeProfiles.flatMap((profile) => ["--profile", profile]),
        ...args,
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: composeEnvironment,
        ...options,
      },
    );

  const oldRustServices = compose(["stop", ...rustPackages]);
  if (!commandSucceeded(oldRustServices)) return oldRustServices.status ?? 1;

  const dependencies = compose(["up", "--build", "--wait", "postgres"]);
  if (!commandSucceeded(dependencies)) return dependencies.status ?? 1;
  const migration = compose(["run", "--build", "--rm", "db-migrate"]);
  if (!commandSucceeded(migration)) return migration.status ?? 1;
  console.log("Native mode PostgreSQL and migrations are ready.");

  const configResult = compose(["config", "--format", "json"], { encoding: "utf8", stdio: "pipe" });
  if (!commandSucceeded(configResult)) {
    console.error(configResult.stderr || configResult.stdout || "Docker Compose config failed.");
    return configResult.status ?? 1;
  }
  let composeConfig;
  try {
    composeConfig = JSON.parse(configResult.stdout);
  } catch (error) {
    console.error(`Could not read resolved Compose settings: ${error.message}`);
    return 1;
  }
  console.log("Native mode loaded resolved database and service settings.");

  const build = spawnSyncImpl(
    "cargo",
    ["build", "--locked", ...rustPackages.flatMap((name) => ["-p", name])],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (!commandSucceeded(build)) return build.status ?? 1;
  console.log("Native Rust binaries are built.");

  const startUi = compose(nativeComposeArgs(mode).slice(composeFiles.length), { stdio: "inherit" });
  if (!commandSucceeded(startUi)) {
    console.error(`Could not start the native-mode UI services (status ${startUi.status}).`);
    return startUi.status ?? 1;
  }

  const databaseUrl = nativeDatabaseUrl(composeConfig);
  if (!databaseUrl) {
    console.error("Could not resolve the development DATABASE_URL from Docker Compose.");
    return 1;
  }
  const collectorConfig = composeConfig.services?.collector?.environment ?? {};
  const geoPath = nativeGeoPath(collectorConfig.GEOIP_DATABASE_PATH);
  const commonEnvironment = { ...process.env, DATABASE_URL: databaseUrl };
  const children = services.map((service) => {
    const serviceEnvironment = {
      ...commonEnvironment,
      RUST_LOG: process.env.RUST_LOG ?? `${service.replaceAll("-", "_")}=info`,
    };
    if (service === "collector") {
      serviceEnvironment.GEOIP_DATABASE_PATH = geoPath;
      serviceEnvironment.GEOIP_TRUSTED_PROXIES = collectorConfig.GEOIP_TRUSTED_PROXIES ?? "";
    }
    if (service === "analytics-api") {
      serviceEnvironment.CONFIG_ADMIN_TOKENS =
        composeConfig.services?.[service]?.environment?.CONFIG_ADMIN_TOKENS ?? "";
    }
    if (service === "processor") {
      serviceEnvironment.PROCESSOR_POLL_INTERVAL_MS =
        composeConfig.services?.[service]?.environment?.PROCESSOR_POLL_INTERVAL_MS ?? "1000";
    }
    const executable = path.join(root, "target", "debug", service);
    const args =
      service === "collector"
        ? ["serve", "--host", "0.0.0.0", "--port", "4001"]
        : service === "analytics-api"
          ? ["--host", "0.0.0.0", "--port", "4002"]
          : [];
    console.log(`Starting native ${service} from target/debug/${service}`);
    return spawnImpl(executable, args, { cwd: root, stdio: "inherit", env: serviceEnvironment });
  });

  return waitForNativeServices(children, {
    compose,
    uiServices: mode === "full" ? ["dashboard", "playground-next"] : ["playground-next"],
  });
}

export function nativeDatabaseUrl(composeConfig) {
  const configured = composeConfig.services?.collector?.environment?.DATABASE_URL;
  if (typeof configured !== "string") return undefined;
  try {
    const databaseUrl = new URL(configured);
    if (databaseUrl.hostname === "postgres") databaseUrl.hostname = "127.0.0.1";
    return databaseUrl.toString();
  } catch {
    return undefined;
  }
}

export function nativeGeoPath(configuredPath = "/workspace/data/GeoLite2-Country.mmdb") {
  if (configuredPath === "/workspace/data/GeoLite2-Country.mmdb") {
    return path.join(root, "data", "GeoLite2-Country.mmdb");
  }
  if (configuredPath.startsWith("/workspace/")) {
    return path.join(root, configuredPath.slice("/workspace/".length));
  }
  return configuredPath;
}

function commandSucceeded(result) {
  if (result.error) {
    console.error(`Failed to start ${result.error.syscall ?? "command"}: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

function waitForNativeServices(children, { compose, uiServices }) {
  return new Promise((resolve) => {
    let stopping = false;
    let exited = 0;
    const stop = (signal = "SIGTERM", exitCode = 0) => {
      if (stopping) return;
      stopping = true;
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      }
      const finish = () => {
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
        compose(["stop", ...uiServices, "postgres"]);
        resolve(exitCode);
      };
      if (children.every((child) => child.exitCode !== null || child.signalCode !== null)) finish();
      else {
        let pending = children.filter(
          (child) => child.exitCode === null && child.signalCode === null,
        ).length;
        for (const child of children) {
          if (child.exitCode !== null || child.signalCode !== null) continue;
          child.once("exit", () => {
            pending -= 1;
            if (pending === 0) finish();
          });
        }
      }
    };
    const onInterrupt = () => stop("SIGINT", 130);
    const onTerminate = () => stop("SIGTERM", 143);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    for (const child of children) {
      child.once("error", (error) => {
        console.error(`Native service process failed: ${error.message}`);
        stop("SIGTERM", 1);
      });
      child.once("exit", (code, signal) => {
        exited += 1;
        if (!stopping && (code !== 0 || signal)) stop("SIGTERM", code ?? 1);
        else if (!stopping && exited === children.length) stop("SIGTERM", 0);
      });
    }
  });
}
