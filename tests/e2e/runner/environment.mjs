import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";

const stateDirectory = (root) => path.join(root, ".cache", "e2e");
const statePath = (root) => path.join(stateDirectory(root), "environment.json");
const lockPath = (root) => path.join(stateDirectory(root), "runner.lock");
const invalidStateMessage =
  "E2E environment state is invalid or belongs to a different Compose configuration. The runner refused database and Compose operations; inspect .cache/e2e/environment.json, stop its E2E project manually, then remove the state file before creating a new environment.";

export function createEnvironmentState({
  root,
  project,
  postgresPort,
  collectorPort,
  analyticsPort,
  dashboardPort,
  playgroundPort,
  adminToken,
  databasePassword,
  cachePrefix,
  ingestKeys = {
    site_playground: randomBytes(32).toString("hex"),
    site_alpha: randomBytes(32).toString("hex"),
    site_beta: randomBytes(32).toString("hex"),
  },
}) {
  return {
    schemaVersion: 1,
    project,
    postgresPort,
    collectorPort,
    analyticsPort,
    dashboardPort,
    playgroundPort,
    adminToken,
    databasePassword,
    cachePrefix,
    ingestKeys,
    fingerprint: environmentFingerprint(root),
  };
}

export function environmentFingerprint(root) {
  const hash = createHash("sha256");
  for (const file of ["compose.yaml", "compose.backend.yaml", "compose.e2e.yaml"]) {
    hash.update(file);
    hash.update(readFileSync(path.join(root, file)));
  }
  return hash.digest("hex");
}

import { readFileSync } from "node:fs";

export async function saveEnvironmentState(root, state) {
  const directory = stateDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = statePath(root);
  const temporaryFile = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporaryFile, 0o600);
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

export async function loadEnvironmentState(root) {
  let state;
  try {
    const file = statePath(root);
    if ((await stat(file)).mode & 0o077) {
      throw new Error("E2E environment state permissions must be 0600.");
    }
    state = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(invalidStateMessage);
  }
  if (
    state.schemaVersion !== 1 ||
    !/^web-analytics-e2e-[a-z0-9-]+$/.test(state.project) ||
    state.fingerprint !== environmentFingerprint(root) ||
    ![
      state.postgresPort,
      state.collectorPort,
      state.analyticsPort,
      state.dashboardPort,
      state.playgroundPort,
    ].every((port) => Number.isInteger(port) && port > 0 && port < 65536) ||
    state.dashboardPort === 65535 ||
    new Set([
      state.postgresPort,
      state.collectorPort,
      state.analyticsPort,
      state.dashboardPort,
      state.playgroundPort,
      state.dashboardPort + 1,
    ]).size !== 6 ||
    typeof state.adminToken !== "string" ||
    state.adminToken.length < 32 ||
    typeof state.databasePassword !== "string" ||
    state.databasePassword.length < 32 ||
    typeof state.cachePrefix !== "string" ||
    !/^web-analytics-e2e-[a-f0-9]{12}$/.test(state.cachePrefix) ||
    !["site_playground", "site_alpha", "site_beta"].every(
      (siteId) =>
        typeof state.ingestKeys?.[siteId] === "string" && state.ingestKeys[siteId].length >= 32,
    )
  ) {
    throw new Error(invalidStateMessage);
  }
  return state;
}

export async function removeEnvironmentState(root) {
  await rm(statePath(root), { force: true });
}

export async function acquireE2ELock(root) {
  await mkdir(stateDirectory(root), { recursive: true, mode: 0o700 });
  const lock = lockPath(root);
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lock, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number.parseInt(await readFile(lock, "utf8").catch(() => ""), 10);
      let processIsAlive = Number.isSafeInteger(owner) && owner > 0;
      if (processIsAlive) {
        try {
          process.kill(owner, 0);
        } catch (probeError) {
          processIsAlive = probeError.code !== "ESRCH";
        }
      }
      if (processIsAlive || attempt > 0) {
        throw new Error("Another E2E runner is using the shared database.");
      }
      await rm(lock, { force: true });
    }
  }
  if (!handle) throw new Error("Could not acquire the shared E2E database lock.");
  return async () => {
    await handle.close();
    await rm(lockPath(root), { force: true });
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function freePorts(count) {
  const ports = [];
  while (ports.length < count) {
    const candidate = await freePort();
    if (ports.every((port) => Math.abs(port - candidate) > 1)) ports.push(candidate);
  }
  return ports;
}

export async function newEnvironmentState(root) {
  const suffix = randomBytes(8).toString("hex");
  const [postgresPort, collectorPort, analyticsPort, dashboardPort, playgroundPort] =
    await freePorts(5);
  return createEnvironmentState({
    root,
    project: `web-analytics-e2e-${suffix}`,
    postgresPort,
    collectorPort,
    analyticsPort,
    dashboardPort,
    playgroundPort,
    adminToken: randomBytes(32).toString("base64url"),
    databasePassword: randomBytes(32).toString("hex"),
    ingestKeys: {
      site_playground: randomBytes(32).toString("hex"),
      site_alpha: randomBytes(32).toString("hex"),
      site_beta: randomBytes(32).toString("hex"),
    },
  });
}
