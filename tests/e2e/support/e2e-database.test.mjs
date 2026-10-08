import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { assertE2EProject, e2ePort } from "./e2e-compose.mjs";
import {
  businessDataResetSql,
  businessDataResetTables,
  resetE2EBusinessData,
} from "./e2e-database.mjs";

test("full E2E reset covers every table created by a database migration", () => {
  const migrationDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "db/migrations",
  );
  const createdTables = new Set();
  for (const filename of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(resolve(migrationDirectory, filename), "utf8");
    for (const match of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      createdTables.add(match[1]);
    }
  }
  assert.deepEqual(
    [...createdTables].filter((table) => !businessDataResetTables.full.includes(table)),
    [],
  );
});

test("E2E reset scopes contain only their approved business tables", () => {
  assert.match(
    businessDataResetSql("full"),
    /^TRUNCATE configuration_capability_runtime_instances,/,
  );
  assert.match(businessDataResetSql("full"), /site_registry/);
  assert.doesNotMatch(businessDataResetSql("full"), /_sqlx_migrations/);
  assert.match(businessDataResetSql("analytics"), /^TRUNCATE analytics_rebuild_queue,/);
  assert.match(businessDataResetSql("dashboard"), /^TRUNCATE dimension_event_facts,/);
  assert.throws(() => businessDataResetSql("all"), /Unknown E2E business-data reset scope/);
});

test("E2E business-data reset refuses non-E2E Compose projects", () => {
  assert.throws(
    () => resetE2EBusinessData({ project: "web-analytics-platform", scope: "analytics" }),
    /Refusing database or Compose operations for non-E2E project/,
  );
});

test("E2E business-data reset runs only the selected approved SQL in its project runner", () => {
  let captured;
  const runCompose = (args) => {
    captured = args;
  };
  Object.defineProperty(runCompose, "e2eProject", { value: "web-analytics-dashboard-e2e-123" });
  resetE2EBusinessData({
    project: "web-analytics-dashboard-e2e-123",
    scope: "dashboard",
    runCompose,
  });

  assert.equal(captured.at(-1), businessDataResetSql("dashboard"));
  assert.equal(captured[1], "-T");
  assert.equal(captured[2], "postgres");
});

test("E2E business-data reset rejects a runner for a different project", () => {
  const runCompose = () => {};
  Object.defineProperty(runCompose, "e2eProject", { value: "web-analytics-dashboard-e2e-456" });
  assert.throws(
    () =>
      resetE2EBusinessData({
        runCompose,
        project: "web-analytics-dashboard-e2e-123",
        scope: "dashboard",
      }),
    /different E2E Compose project/,
  );
});

test("E2E project names are limited to suite-specific disposable projects", () => {
  assert.doesNotThrow(() => assertE2EProject("web-analytics-e2e-123"));
  assert.doesNotThrow(() => assertE2EProject("web-analytics-router-compose-123"));
  assert.throws(() => assertE2EProject("web-analytics-platform"));
});

test("E2E port parsing applies defaults and rejects invalid overrides", () => {
  const name = "E2E_SUPPORT_TEST_PORT";
  const original = process.env[name];
  try {
    delete process.env[name];
    assert.equal(e2ePort(name, 15432), "15432");
    process.env[name] = "15433";
    assert.equal(e2ePort(name, 15432), "15433");
    process.env[name] = "70000";
    assert.throws(() => e2ePort(name, 15432), /between 1 and 65535/);
    process.env[name] = "not-a-port";
    assert.throws(() => e2ePort(name, 15432), /integer TCP port/);
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});
