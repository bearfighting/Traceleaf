import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireE2ELock,
  createEnvironmentState,
  loadEnvironmentState,
  saveEnvironmentState,
} from "./environment.mjs";
import { parseE2EArguments } from "./suite-registry.mjs";

test("suite parser expands groups, deduplicates, and preserves selection order", () => {
  assert.deepEqual(
    parseE2EArguments(["--suite", "api", "--suite", "analytics,onboarding"]).suites,
    ["analytics", "configuration", "site-management", "site-onboarding"],
  );
  assert.equal(parseE2EArguments(["--all"]).suites.length, 8);
  assert.throws(() => parseE2EArguments(["--all", "--suite", "analytics"]), /cannot be combined/);
  assert.throws(() => parseE2EArguments(["--suite", "unknown"]), /Unknown E2E suite/);
  assert.throws(() => parseE2EArguments(["--mystery"]), /Unknown E2E option/);
});

test("environment state is private, checkout-bound, and rejects changed compose files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "e2e-state-"));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(root, { recursive: true });
    for (const file of ["compose.yaml", "compose.backend.yaml", "compose.e2e.yaml"])
      await writeFile(path.join(root, file), file);
    const state = createEnvironmentState({
      root,
      project: "web-analytics-e2e-abcd1234",
      postgresPort: 15432,
      collectorPort: 14001,
      analyticsPort: 14002,
      dashboardPort: 13000,
      playgroundPort: 3000,
      adminToken: "a".repeat(64),
      databasePassword: "b".repeat(64),
      cachePrefix: "web-analytics-e2e-012345abcdef",
    });
    await saveEnvironmentState(root, state);
    assert.equal((await stat(path.join(root, ".cache/e2e/environment.json"))).mode & 0o777, 0o600);
    assert.equal((await loadEnvironmentState(root)).project, state.project);
    await writeFile(path.join(root, "compose.e2e.yaml"), "changed");
    await assert.rejects(loadEnvironmentState(root), /refused database and Compose operations/);
    assert.equal(
      (await readFile(path.join(root, ".cache/e2e/environment.json"), "utf8")).includes(
        state.adminToken,
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shared E2E database lock rejects a concurrent runner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "e2e-lock-"));
  try {
    const release = await acquireE2ELock(root);
    await assert.rejects(acquireE2ELock(root), /Another E2E runner/);
    await release();
    const releaseAgain = await acquireE2ELock(root);
    await releaseAgain();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
