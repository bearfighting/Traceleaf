import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareE2ECaches } from "../support/e2e-cache.mjs";
import { seedE2ECapabilityConfigurations } from "../support/e2e-capabilities.mjs";
import { createE2EComposeRunner } from "../support/e2e-compose.mjs";
import { resetE2EBusinessData } from "../support/e2e-database.mjs";
import {
  acquireE2ELock,
  loadEnvironmentState,
  newEnvironmentState,
  removeEnvironmentState,
  saveEnvironmentState,
} from "./environment.mjs";
import { parseE2EArguments, suiteRegistry } from "./suite-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const command = process.argv[2];
const composeFiles = ["compose.yaml", "compose.backend.yaml", "compose.e2e.yaml"];
function compose(state, args) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      state.project,
      ...composeFiles.flatMap((file) => ["-f", file]),
      "--profile",
      "backend",
      "--profile",
      "storage",
      "--profile",
      "processing",
      "--profile",
      "dashboard",
      "--profile",
      "playground-next",
      ...args,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_POSTGRES_PORT: String(state.postgresPort),
        E2E_COLLECTOR_PORT: String(state.collectorPort),
        E2E_ANALYTICS_API_PORT: String(state.analyticsPort),
        E2E_SITE_API_PORT: String(state.analyticsPort),
        E2E_SITE_COLLECTOR_PORT: String(state.collectorPort),
        E2E_SITE_POSTGRES_PORT: String(state.postgresPort),
        E2E_POSTGRES_PORT: String(state.postgresPort),
        E2E_ONBOARDING_DASHBOARD_PORT: String(state.dashboardPort),
        E2E_ONBOARDING_COLLECTOR_PORT: String(state.collectorPort),
        E2E_ONBOARDING_API_PORT: String(state.analyticsPort),
        E2E_ONBOARDING_POSTGRES_PORT: String(state.postgresPort),
        E2E_ONBOARDING_PLAYGROUND_PORT: String(state.playgroundPort),
        DASHBOARD_PORT: String(state.dashboardPort),
        PLAYGROUND_NEXT_PORT: String(state.playgroundPort),
        DASHBOARD_ERROR_E2E_PORT: String(state.dashboardPort + 1),
        E2E_CACHE_SCOPE: "shared",
        E2E_INGEST_KEY_PLAYGROUND: state.ingestKeys.site_playground,
        E2E_INGEST_KEY_ALPHA: state.ingestKeys.site_alpha,
        E2E_INGEST_KEY_BETA: state.ingestKeys.site_beta,
        CONFIG_ADMIN_TOKENS: state.adminToken,
        POSTGRES_PASSWORD: state.databasePassword,
        COLLECTOR_DATABASE_URL: `postgres://analytics:${state.databasePassword}@postgres:5432/analytics`,
        E2E_CACHE_PREFIX: state.cachePrefix,
      },
    },
  );
  if (result.status !== 0)
    throw new Error(`docker compose exited with status ${result.status ?? "unknown"}.`);
}

async function startEnvironment(state) {
  state.cachePrefix = prepareE2ECaches(root, "shared");
  await saveEnvironmentState(root, state);
  try {
    compose(state, ["up", "-d", "--build", "--wait", "postgres"]);
    compose(state, ["up", "-d", "--build", "db-migrate"]);
    compose(state, ["wait", "db-migrate"]);
    resetBaseline(state);
  } catch (error) {
    let cleaned = false;
    try {
      compose(state, ["down", "--volumes", "--remove-orphans"]);
      cleaned = true;
    } catch {
      // Preserve the startup error; the managed project remains safely named for manual cleanup.
    }
    if (cleaned) await removeEnvironmentState(root);
    throw error;
  }
}

function resetBaseline(state) {
  const { runCompose } = createE2EComposeRunner({
    root,
    project: state.project,
    profiles: ["backend", "storage", "processing"],
    env: composeEnvironment(state),
  });
  resetE2EBusinessData({ runCompose, project: state.project, scope: "full" });
  seedE2ECapabilityConfigurations(runCompose);
}

function composeEnvironment(state) {
  return {
    E2E_POSTGRES_PORT: String(state.postgresPort),
    E2E_COLLECTOR_PORT: String(state.collectorPort),
    E2E_ANALYTICS_API_PORT: String(state.analyticsPort),
    E2E_SITE_API_PORT: String(state.analyticsPort),
    E2E_SITE_COLLECTOR_PORT: String(state.collectorPort),
    E2E_SITE_POSTGRES_PORT: String(state.postgresPort),
    CONFIG_ADMIN_TOKENS: JSON.stringify([state.adminToken]),
    DASHBOARD_DEFAULT_ENVIRONMENT: "e2e",
    POSTGRES_PASSWORD: state.databasePassword,
    COLLECTOR_DATABASE_URL: `postgres://analytics:${state.databasePassword}@postgres:5432/analytics`,
    E2E_CACHE_PREFIX: state.cachePrefix,
    E2E_CACHE_SCOPE: "shared",
    E2E_INGEST_KEY_PLAYGROUND: state.ingestKeys.site_playground,
    E2E_INGEST_KEY_ALPHA: state.ingestKeys.site_alpha,
    E2E_INGEST_KEY_BETA: state.ingestKeys.site_beta,
  };
}

try {
  if ((command === "up" || command === "down") && process.argv.length !== 3) {
    throw new Error(`The 'e2e ${command}' command does not accept arguments.`);
  }
  if (command === "up") {
    const existing = await loadEnvironmentState(root);
    if (existing)
      throw new Error("An E2E environment already exists; run e2e:down before replacing it.");
    const release = await acquireE2ELock(root);
    try {
      await startEnvironment(await newEnvironmentState(root));
    } finally {
      await release();
    }
  } else if (command === "down") {
    const state = await loadEnvironmentState(root);
    if (!state) process.stdout.write("No managed E2E environment is recorded.\n");
    else {
      const release = await acquireE2ELock(root);
      try {
        compose(state, ["down", "--volumes", "--remove-orphans"]);
        await removeEnvironmentState(root);
      } finally {
        await release();
      }
    }
  } else {
    const selection = parseE2EArguments(process.argv.slice(2));
    const existing = await loadEnvironmentState(root);
    const needsSharedEnvironment = selection.suites.some((id) => suiteRegistry[id].shared);
    const owned = needsSharedEnvironment && !existing;
    const state = existing ?? (needsSharedEnvironment ? await newEnvironmentState(root) : null);
    const release = await acquireE2ELock(root);
    let success = false;
    try {
      if (owned) await startEnvironment(state);
      for (const id of selection.suites) {
        process.stdout.write(`\n=== E2E ${id} ===\n`);
        if (suiteRegistry[id].shared) {
          const resetScope = suiteRegistry[id].reset;
          if (resetScope !== "full") {
            throw new Error(`Suite '${id}' has an unsupported reset scope.`);
          }
          resetBaseline(state);
        }
        const result = spawnSync(
          process.execPath,
          [path.join(root, "tests/e2e/suites", suiteRegistry[id].script)],
          {
            cwd: root,
            stdio: "inherit",
            env: {
              ...process.env,
              ...(state && suiteRegistry[id].shared
                ? {
                    E2E_SHARED_PROJECT: state.project,
                    E2E_ADMIN_TOKEN: state.adminToken,
                    ...composeEnvironment(state),
                    DASHBOARD_CONFIG_ADMIN_TOKEN: state.adminToken,
                    DASHBOARD_PORT: String(state.dashboardPort),
                    PLAYGROUND_NEXT_PORT: String(state.playgroundPort),
                    DASHBOARD_ERROR_E2E_PORT: String(state.dashboardPort + 1),
                  }
                : {}),
            },
          },
        );
        if (result.status !== 0)
          throw new Error(`E2E suite '${id}' failed (status ${result.status ?? "unknown"}).`);
      }
      success = true;
    } finally {
      try {
        if (owned && !selection.keepEnvironment)
          compose(state, ["down", "--volumes", "--remove-orphans"]);
        if (owned && selection.keepEnvironment)
          process.stdout.write("E2E environment retained; run pnpm e2e:down to remove it.\n");
        if (owned && !selection.keepEnvironment) await removeEnvironmentState(root);
      } finally {
        await release();
      }
      if (!success) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
