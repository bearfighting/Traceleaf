/* global console, fetch, process */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ulid } from "ulid";

import { prepareE2ECaches } from "./e2e-cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `web-analytics-dev-startup-e2e-${process.pid}`;
const collectorPort = process.env.E2E_COLLECTOR_PORT ?? "14043";
const postgresPort = process.env.E2E_POSTGRES_PORT ?? "15443";
const dashboardPort = process.env.E2E_DASHBOARD_PORT ?? "13143";
const playgroundPort = process.env.E2E_PLAYGROUND_PORT ?? "13043";
const collectorUrl = `http://127.0.0.1:${collectorPort}`;
const localKey = `m8-local-${randomBytes(12).toString("hex")}`;
const localOrigin = `http://localhost:${playgroundPort}`;
const composeArgs = [
  "compose",
  "-p",
  project,
  "-f",
  "compose.yaml",
  "-f",
  "compose.backend.yaml",
  "-f",
  "compose.e2e.yaml",
  "-f",
  "compose.dev.yaml",
  "--profile",
  "storage",
  "--profile",
  "backend",
  "--profile",
  "processing",
  "--profile",
  "dashboard",
  "--profile",
  "playground-next",
];

function runCompose(args, { capture = false, allowFailure = false } = {}) {
  try {
    return execFileSync("docker", [...composeArgs, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        LOCAL_DEV_INGEST_KEY: localKey,
        PLAYGROUND_ORIGINS: localOrigin,
        PLAYGROUND_NEXT_PORT: playgroundPort,
        DASHBOARD_PORT: dashboardPort,
        E2E_DASHBOARD_PORT: dashboardPort,
        E2E_COLLECTOR_PORT: collectorPort,
        E2E_POSTGRES_PORT: postgresPort,
      },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
  } catch (error) {
    if (allowFailure) return "";
    const output = [error.stdout ?? "", error.stderr ?? ""].filter(Boolean).join("\n").trim();
    throw new Error(`docker compose ${args.join(" ")} failed${output ? `:\n${output}` : ""}`, {
      cause: error,
    });
  }
}

function query(sql) {
  return runCompose(
    ["exec", "-T", "postgres", "psql", "-U", "analytics", "-d", "analytics", "-At", "-c", sql],
    { capture: true },
  ).trim();
}

async function postEvent(origin, eventId) {
  return fetch(`${collectorUrl}/v1/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-ingest-key": localKey,
    },
    body: JSON.stringify({
      schema_version: 1,
      events: [
        {
          schema_version: 1,
          event_id: eventId,
          type: "page_view",
          site_id: "site_example",
          occurred_at: Date.now(),
          path: "/m6-seed-check",
        },
      ],
    }),
  });
}

async function main() {
  prepareE2ECaches(root, "dev-startup");

  runCompose([
    "up",
    "-d",
    "--build",
    "--wait",
    "postgres",
    "collector",
    "analytics-api",
    "processor",
    "dashboard",
    "playground-next",
  ]);
  assert.equal(
    query("SELECT count(*) FROM site_registry"),
    "0",
    "default startup must keep Registry empty",
  );
  console.log("PASS default backend startup is healthy with an empty Site Registry");

  runCompose(["down"]);
  runCompose(["run", "--build", "--rm", "dev-seed"]);
  assert.equal(query("SELECT count(*) FROM site_registry WHERE site_id = 'site_example'"), "1");
  assert.equal(
    query(
      "SELECT display_name || '|' || website_url FROM site_registry WHERE site_id = 'site_example'",
    ),
    "Local Example Site|http://localhost:3000",
  );
  assert.equal(
    query("SELECT count(*) FROM site_capability_configurations WHERE site_id = 'site_example'"),
    "1",
  );
  assert.equal(
    query(
      "SELECT count(*) FROM site_environment_policies WHERE site_id = 'site_example' AND environment = 'development'",
    ),
    "1",
  );
  assert.equal(
    query("SELECT count(*) FROM raw_events"),
    "0",
    "seed must not create analytics events",
  );
  assert.equal(
    query(`SELECT
      (SELECT count(*) FROM normalized_event_context) +
      (SELECT count(*) FROM visitor_event_facts) +
      (SELECT count(*) FROM session_events) +
      (SELECT count(*) FROM sessions) +
      (SELECT count(*) FROM visitor_daily) +
      (SELECT count(*) FROM session_daily) +
      (SELECT count(*) FROM page_view_daily) +
      (SELECT count(*) FROM page_view_routes) +
      (SELECT count(*) FROM page_view_totals) +
      (SELECT count(*) FROM dimension_event_facts) +
      (SELECT count(*) FROM dimension_daily) +
      (SELECT count(*) FROM custom_event_facts) +
      (SELECT count(*) FROM conversion_facts) +
      (SELECT count(*) FROM funnel_step_facts) +
      (SELECT count(*) FROM web_vital_facts) +
      (SELECT count(*) FROM geo_event_metadata) +
      (SELECT count(*) FROM geo_country_facts)`),
    "0",
    "seed must not create derived analytics facts",
  );
  assert.equal(
    query("SELECT count(*) FROM site_definition_revisions"),
    "0",
    "seed must not create definition revisions",
  );
  console.log("PASS explicit seed creates the fixed demo Site and runtime configuration");

  runCompose([
    "up",
    "-d",
    "--build",
    "--wait",
    "postgres",
    "collector",
    "analytics-api",
    "processor",
    "dashboard",
    "playground-next",
  ]);

  const accepted = await postEvent(localOrigin, ulid());
  const acceptedBody = await accepted.json();
  assert.equal(
    accepted.status,
    202,
    `allowed Origin was rejected: ${JSON.stringify(acceptedBody)}`,
  );
  assert.equal(acceptedBody.accepted, 1);

  const denied = await postEvent("http://disallowed.example", ulid());
  assert.notEqual(denied.status, 202, "unlisted Origin must not ingest an event");
  assert.equal(query("SELECT count(*) FROM raw_events WHERE site_id = 'site_example'"), "1");
  console.log("PASS seeded key and Origin accept only the configured local Origin");

  runCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "analytics",
    "-d",
    "analytics",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "UPDATE site_environment_policies SET document = jsonb_set(document, '{allowed_origins}', '[\"http://manual.example\"]'::jsonb) WHERE site_id = 'site_example' AND environment = 'development'; UPDATE site_capability_configurations SET document = jsonb_set(document, '{capabilities,web_vitals,enabled}', 'false'::jsonb) WHERE site_id = 'site_example'",
  ]);
  runCompose(["run", "--build", "--rm", "dev-seed"]);
  assert.equal(
    query(
      "SELECT document->'allowed_origins' FROM site_environment_policies WHERE site_id = 'site_example' AND environment = 'development'",
    ),
    '["http://manual.example"]',
    "repeated seed must preserve a manually changed policy",
  );
  assert.equal(
    query(
      "SELECT document #>> '{capabilities,web_vitals,enabled}' FROM site_capability_configurations WHERE site_id = 'site_example'",
    ),
    "false",
    "repeated seed must preserve manually changed capabilities",
  );
  console.log("PASS repeated seed preserves manually changed Site policy");

  runCompose(["down"]);
  runCompose([
    "up",
    "-d",
    "--build",
    "--wait",
    "postgres",
    "collector",
    "analytics-api",
    "processor",
    "dashboard",
    "playground-next",
  ]);
  assert.equal(query("SELECT count(*) FROM site_registry WHERE site_id = 'site_example'"), "1");
  assert.equal(
    query(
      "SELECT document->'allowed_origins' FROM site_environment_policies WHERE site_id = 'site_example' AND environment = 'development'",
    ),
    '["http://manual.example"]',
  );
  assert.equal(
    query(
      "SELECT document #>> '{capabilities,web_vitals,enabled}' FROM site_capability_configurations WHERE site_id = 'site_example'",
    ),
    "false",
  );
  assert.equal(
    query("SELECT count(*) FROM site_registry"),
    "1",
    "ordinary startup must not add or remove Registry entries",
  );
  console.log("PASS ordinary startup leaves existing Registry and manual configuration unchanged");

  runCompose(["down"]);
  runCompose(["up", "-d", "--wait", "postgres"]);
  assert.equal(query("SELECT count(*) FROM site_registry WHERE site_id = 'site_example'"), "1");
  assert.equal(
    query(
      "SELECT document->'allowed_origins' FROM site_environment_policies WHERE site_id = 'site_example' AND environment = 'development'",
    ),
    '["http://manual.example"]',
  );
  assert.equal(
    query(
      "SELECT document #>> '{capabilities,web_vitals,enabled}' FROM site_capability_configurations WHERE site_id = 'site_example'",
    ),
    "false",
  );
  console.log("PASS down/up retains the seeded Site and manual configuration");
}

try {
  await main();
  console.log("Development startup E2E workflow passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  runCompose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
}
