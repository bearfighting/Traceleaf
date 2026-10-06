/* global console, fetch, process, setTimeout */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ulid } from "ulid";

import { prepareE2ECaches } from "../support/e2e-cache.mjs";
import {
  captureE2EComposeDiagnostics,
  createE2EComposeRunner,
  e2ePort,
  migrateE2EDatabase,
  removeE2EComposeProject,
  waitForHttpService,
} from "../support/e2e-compose.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const managed = Boolean(process.env.E2E_SHARED_PROJECT);
const project =
  process.env.E2E_SHARED_PROJECT ?? `web-analytics-site-management-e2e-${process.pid}`;
const apiPort = e2ePort("E2E_SITE_API_PORT", 14112);
const collectorPort = e2ePort("E2E_SITE_COLLECTOR_PORT", 14111);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const collectorUrl = `http://127.0.0.1:${collectorPort}`;
const token = process.env.E2E_ADMIN_TOKEN ?? randomBytes(32).toString("base64url");
const origin = "https://site-management-e2e.example.test";
const day = new Date().toISOString().slice(0, 10);
const { runCompose } = createE2EComposeRunner({
  root,
  project,
  profiles: ["backend", "storage", "processing"],
  env: {
    CONFIG_ADMIN_TOKENS: JSON.stringify([token]),
    E2E_ANALYTICS_API_PORT: apiPort,
    E2E_COLLECTOR_PORT: collectorPort,
    E2E_POSTGRES_PORT: e2ePort("E2E_SITE_POSTGRES_PORT", 15442),
  },
});
const compose = (args, options = {}) =>
  runCompose(args, typeof options === "boolean" ? { capture: options } : options);

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function admin(pathname, options = {}) {
  return fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
}

async function json(response, label) {
  const body = await response.json();
  assert(response.ok, `${label}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function waitForRuntime(pathname, label) {
  const deadline = Date.now() + 30_000;
  let lastState = "unavailable";
  while (Date.now() < deadline) {
    const response = await admin(pathname);
    if (response.ok) {
      const body = await response.json();
      lastState = body.effective_state?.status ?? "missing";
      if (lastState === "current") return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} runtime state did not converge (last status: ${lastState})`);
}

async function main() {
  if (!managed) {
    prepareE2ECaches(root, "site-management");
    compose(["up", "-d", "--build", "--wait", "postgres"]);
    migrateE2EDatabase(compose);
  }
  compose([
    "up",
    "-d",
    ...(!managed ? ["--build"] : []),
    "--wait",
    ...(managed ? ["--no-deps"] : []),
    "collector",
    "analytics-api",
    "processor",
  ]);
  await waitForHttpService("Analytics API", `${apiUrl}/health`);

  const createdResponse = await admin("/v1/admin/sites", {
    method: "POST",
    headers: { "Idempotency-Key": `e2e-${ulid()}` },
    body: JSON.stringify({
      display_name: `E2E Site ${ulid()}`,
      website_url: origin,
      environment: "production",
      allowed_origins: [origin],
      capabilities: {},
    }),
  });
  assert(createdResponse.status === 201, `Site creation returned ${createdResponse.status}`);
  assert(
    createdResponse.headers.get("cache-control") === "no-store",
    "Initial response must be no-store",
  );
  const created = await createdResponse.json();
  const siteId = created.site.site_id;
  const key = created.ingest_key.key;
  assert(siteId && key, "Create response must contain site ID and initial key");

  await waitForRuntime(`/v1/admin/sites/${siteId}/capabilities`, "Capabilities");
  await waitForRuntime(
    `/v1/admin/sites/${siteId}/environments/production/ingest-policy`,
    "Ingest policy",
  );

  const event = {
    schema_version: 1,
    event_id: ulid(),
    type: "page_view",
    site_id: siteId,
    occurred_at: Date.now(),
    path: "/m5-site-management-e2e",
    url: `${origin}/m5-site-management-e2e`,
    title: "M5 Site Management E2E",
  };
  const ingest = await fetch(`${collectorUrl}/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Ingest-Key": key },
    body: JSON.stringify({ schema_version: 1, events: [event] }),
  });
  const ingestBody = await ingest.json();
  assert(
    ingest.status === 202 && ingestBody.accepted === 1,
    `Collector rejected event: ${JSON.stringify(ingestBody)}`,
  );

  compose([
    "run",
    "--rm",
    "--no-deps",
    "--build",
    "--entrypoint",
    "cargo",
    "processor",
    "run",
    "-p",
    "processor",
    "--",
    "--once",
  ]);
  const reportUrl = `${apiUrl}/v1/sites/${siteId}/reports/${day}/${day}/pages`;
  const reportResponse = await fetch(reportUrl);
  const report = await reportResponse.json();
  assert(reportResponse.ok, `Analytics report failed: ${JSON.stringify(report)}`);
  assert(
    report.items?.some((item) => item.path === event.path && item.page_views === 1),
    `Processed page view missing: ${JSON.stringify(report)}`,
  );

  const listed = await json(await admin("/v1/admin/sites"), "Site list");
  assert(
    listed.items?.some((item) => item.site_id === siteId),
    "New Site missing from directory",
  );
  const detailed = await json(await admin(`/v1/admin/sites/${siteId}`), "Site detail");
  assert(detailed.site.site_id === siteId, "Site detail returned wrong Site");
  const updated = await json(
    await admin(`/v1/admin/sites/${siteId}`, {
      method: "PATCH",
      headers: { "If-Match": `"${detailed.site.version}"` },
      body: JSON.stringify({ display_name: "Updated M5 E2E Site" }),
    }),
    "Update Site metadata",
  );
  assert(
    updated.site.display_name === "Updated M5 E2E Site",
    "Site metadata update was not persisted",
  );
  const replayKey = `e2e-replay-${ulid()}`;
  const replayRequest = {
    display_name: "Replay Probe",
    website_url: origin,
    environment: "production",
    allowed_origins: [origin],
    capabilities: {},
  };
  const first = await admin("/v1/admin/sites", {
    method: "POST",
    headers: { "Idempotency-Key": replayKey },
    body: JSON.stringify(replayRequest),
  });
  assert(first.status === 201, "Replay probe creation failed");
  const firstBody = await first.json();
  const replay = await admin("/v1/admin/sites", {
    method: "POST",
    headers: { "Idempotency-Key": replayKey },
    body: JSON.stringify(replayRequest),
  });
  const replayBody = await replay.json();
  assert(
    replay.status === 200 && !replayBody.ingest_key,
    "Idempotent replay must not reveal plaintext key",
  );
  assert(firstBody.ingest_key.key, "First create response must include key");

  const archived = await json(
    await admin(`/v1/admin/sites/${siteId}/archive`, {
      method: "POST",
      headers: { "If-Match": `"${updated.site.version}"` },
    }),
    "Archive Site",
  );
  assert(archived.site.lifecycle_status === "archived", "Site did not archive");
  const rejectDeadline = Date.now() + 30_000;
  let rejected;
  while (Date.now() < rejectDeadline) {
    rejected = await fetch(`${collectorUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "X-Ingest-Key": key },
      body: JSON.stringify({
        schema_version: 1,
        events: [{ ...event, event_id: ulid(), occurred_at: Date.now() }],
      }),
    });
    if (rejected.status >= 400) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert(rejected?.status >= 400, `Archived Site continued accepting events (${rejected?.status})`);
  const retained = await fetch(reportUrl);
  const retainedReport = await retained.json();
  assert(
    retained.ok && retainedReport.items?.some((item) => item.path === event.path),
    "Archive removed historical analytics",
  );
  const restored = await json(
    await admin(`/v1/admin/sites/${siteId}/restore`, {
      method: "POST",
      headers: { "If-Match": `"${archived.site.version}"` },
    }),
    "Restore Site",
  );
  assert(restored.site.lifecycle_status === "active", "Site did not restore");
  const auditOperations = compose(
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "analytics",
      "-d",
      "analytics",
      "-Atc",
      `SELECT string_agg(operation, ',' ORDER BY site_version) FROM site_management_audit WHERE site_id='${siteId}'`,
    ],
    true,
  ).trim();
  assert(
    auditOperations === "created,metadata_updated,archived,restored",
    `Unexpected Site audit history: ${auditOperations}`,
  );
  console.log(`Site Management E2E passed for ${siteId}.`);
}

try {
  await main();
} catch (error) {
  try {
    await captureE2EComposeDiagnostics({
      runCompose,
      artifactDirectory: path.join(root, "artifacts", "site-management-e2e"),
      services: ["postgres", "db-migrate", "collector", "analytics-api", "processor"],
    });
  } catch (artifactError) {
    console.error(`Could not capture Compose diagnostics: ${artifactError}`);
  }
  console.error(error instanceof Error ? error.message : String(error));
  try {
    process.stderr.write(compose(["ps", "-a"], true));
  } catch {
    /* diagnostics are best effort */
  }
  process.exitCode = 1;
} finally {
  if (!managed) removeE2EComposeProject(compose);
}
