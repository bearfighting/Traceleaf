/* global console, fetch, process, setTimeout */

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";
import { ulid } from "ulid";

import { seedE2ECapabilityConfigurations } from "../support/e2e-capabilities.mjs";
import { prepareE2ECaches } from "../support/e2e-cache.mjs";
import {
  captureE2EComposeDiagnostics,
  createE2EComposeRunner,
  e2ePort,
  removeE2EComposeProject,
  waitForHttpService,
} from "../support/e2e-compose.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const managed = Boolean(process.env.E2E_SHARED_PROJECT);
const project = process.env.E2E_SHARED_PROJECT ?? `web-analytics-configuration-e2e-${process.pid}`;
const token = process.env.E2E_ADMIN_TOKEN ?? randomBytes(32).toString("base64url");
const environment = "e2e";
const historyDates = [];
const dashboardPort = e2ePort("DASHBOARD_PORT", 13100);
const collectorPort = e2ePort("E2E_COLLECTOR_PORT", 14101);
const analyticsApiPort = e2ePort("E2E_ANALYTICS_API_PORT", 14102);
const postgresPort = e2ePort("E2E_POSTGRES_PORT", 15433);
const apiUrl = `http://127.0.0.1:${analyticsApiPort}`;
const collectorUrl = `http://127.0.0.1:${collectorPort}`;
const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
const artifactDirectory = path.join(root, "artifacts", "configuration-e2e");
const { runCompose } = createE2EComposeRunner({
  root,
  project,
  profiles: ["backend", "storage", "processing", "dashboard"],
  env: {
    CONFIG_ADMIN_TOKENS: JSON.stringify([token]),
    DASHBOARD_CONFIG_ADMIN_TOKEN: token,
    DASHBOARD_DEFAULT_ENVIRONMENT: environment,
    DASHBOARD_PORT: dashboardPort,
    E2E_COLLECTOR_PORT: collectorPort,
    E2E_ANALYTICS_API_PORT: analyticsApiPort,
    E2E_POSTGRES_PORT: postgresPort,
  },
});
const adminHeaders = { Authorization: `Bearer ${token}` };
const sites = ["site_playground", "site_alpha"];
let browser;
let page;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, options = {}) {
  return fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      ...adminHeaders,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
}

async function json(response, description) {
  const body = await response.json();
  assert(response.ok, `${description} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function waitForCapabilities(siteId, version) {
  const deadline = Date.now() + 30_000;
  let lastEffectiveState;
  while (Date.now() < deadline) {
    const response = await request(`/v1/admin/sites/${siteId}/capabilities`);
    if (response.ok) {
      const body = await response.json();
      lastEffectiveState = body.effective_state;
      const applied = body.effective_state.applied_versions;
      if (
        body.effective_state.status === "current" &&
        ["collector", "processor", "analytics_api"].every((service) => applied[service] >= version)
      )
        return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Capability version ${version} did not converge for ${siteId}: ${JSON.stringify(lastEffectiveState ?? null)}`,
  );
}

async function waitForPolicy(siteId, version) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await request(
      `/v1/admin/sites/${siteId}/environments/${environment}/ingest-policy`,
    );
    if (response.ok) {
      const body = await response.json();
      if (
        body.effective_state.status === "current" &&
        body.effective_state.applied_versions.collector >= version
      ) {
        return body;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Ingest policy version ${version} did not converge for ${siteId}`);
}

async function putCapabilities(siteId, configuration) {
  const response = await request(`/v1/admin/sites/${siteId}/capabilities`, {
    method: "PUT",
    headers: { "If-Match": `"${configuration.version}"` },
    body: JSON.stringify({ capabilities: configuration.capabilities }),
  });
  return json(response, `Updating ${siteId} capabilities`);
}

async function setupPolicies() {
  for (const siteId of sites) {
    const policyPath = `/v1/admin/sites/${siteId}/environments/${environment}/ingest-policy`;
    const created = await request(policyPath, {
      method: "POST",
      headers: { "If-None-Match": "*" },
      body: JSON.stringify({
        enabled: true,
        allowed_origins: ["http://localhost:3000"],
        rate_limit_per_minute: 600,
      }),
    });
    const policy = await json(created, `Creating ${siteId} policy`);
    const keyResponse = await request(
      `/v1/admin/sites/${siteId}/environments/${environment}/ingest-keys`,
      {
        method: "POST",
        headers: { "If-Match": `"${policy.policy.version}"` },
      },
    );
    const key = await json(keyResponse, `Creating ${siteId} ingest key`);
    await waitForPolicy(siteId, key.effective_state.stored_version);
    keys[siteId] = key.key;
  }
}

const keys = {};

async function postPageView(siteId, eventSuffix, expectedStatus = 202, clientIp) {
  const occurredAt = Date.now();
  const response = await fetch(`${collectorUrl}/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      "X-Ingest-Key": keys[siteId],
      ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
    },
    body: JSON.stringify({
      schema_version: 1,
      events: [
        {
          schema_version: 1,
          event_id: ulid(),
          type: "page_view",
          site_id: siteId,
          occurred_at: occurredAt,
          path: `/${siteId}/${eventSuffix}`,
        },
      ],
    }),
  });
  const body = await response.json();
  assert(
    response.status === expectedStatus,
    `Collector returned ${response.status} for ${siteId}, expected ${expectedStatus}: ${JSON.stringify(body)}`,
  );
  if (expectedStatus === 202) {
    assert(
      body.accepted === 1,
      `Collector did not accept ${siteId} event: ${JSON.stringify(body)}`,
    );
    historyDates.push(new Date(occurredAt).toISOString().slice(0, 10));
  }
}

function historicalWindow() {
  assert(historyDates.length > 0, "No accepted events are available for historical queries");
  const dates = [...historyDates].sort();
  return { from: dates[0], to: dates.at(-1) };
}

async function runProcessorOnce() {
  runCompose(
    [
      "run",
      "--rm",
      "--no-deps",
      ...(!managed ? ["--build"] : []),
      "--entrypoint",
      "cargo",
      "processor",
      "run",
      "-p",
      "processor",
      "--",
      "once",
      "process",
    ],
    { capture: true },
  );
}

async function readCount(table, siteId) {
  return Number(
    runCompose(
      [
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
        "-At",
        "-c",
        `SELECT COUNT(*) FROM ${table} WHERE site_id = '${siteId}'`,
      ],
      { capture: true },
    ).trim(),
  );
}

async function assertConfigurationWorkflow() {
  const initial = await json(
    await request("/v1/admin/sites/site_playground/capabilities"),
    "Reading initial capabilities",
  );
  const original = structuredClone(initial.configuration);
  const disabledCapabilities = structuredClone(original.capabilities);
  disabledCapabilities.geo.enabled = false;
  const disabled = await putCapabilities("site_playground", {
    ...original,
    capabilities: disabledCapabilities,
  });
  const disabledVersion = disabled.configuration.version;
  assert(
    disabledVersion === original.version + 1,
    "Capability update did not increment its version",
  );
  const persisted = await waitForCapabilities("site_playground", disabledVersion);
  assert(
    persisted.configuration.capabilities.geo.enabled === false,
    "Disabled capability was not persisted",
  );

  const conflict = await request("/v1/admin/sites/site_playground/capabilities", {
    method: "PUT",
    headers: { "If-Match": `"${original.version}"` },
    body: JSON.stringify({ capabilities: original.capabilities }),
  });
  assert(
    conflict.status === 409,
    `Expected stale capability update to conflict, received ${conflict.status}`,
  );

  const policyPath = `/v1/admin/sites/site_playground/environments/${environment}/ingest-policy`;
  const activePolicy = await json(await request(policyPath), "Reading ingest policy");
  const stopped = await json(
    await request(policyPath, {
      method: "PUT",
      headers: { "If-Match": `"${activePolicy.policy.version}"` },
      body: JSON.stringify({
        enabled: false,
        allowed_origins: activePolicy.policy.allowed_origins,
        rate_limit_per_minute: activePolicy.policy.rate_limit_per_minute,
      }),
    }),
    "Disabling ingest policy",
  );
  assert(
    stopped.policy.version === activePolicy.policy.version + 1,
    "Policy update did not increment its version",
  );
  await waitForPolicy("site_playground", stopped.policy.version);
  await postPageView("site_playground", "f", 403);
  const restoredPolicy = await json(
    await request(policyPath, {
      method: "PUT",
      headers: { "If-Match": `"${stopped.policy.version}"` },
      body: JSON.stringify({
        enabled: true,
        allowed_origins: stopped.policy.allowed_origins,
        rate_limit_per_minute: stopped.policy.rate_limit_per_minute,
      }),
    }),
    "Re-enabling ingest policy",
  );
  assert(
    restoredPolicy.policy.version === stopped.policy.version + 1,
    "Policy rollback must be a new version",
  );
  await waitForPolicy("site_playground", restoredPolicy.policy.version);

  const restoredCaps = await putCapabilities("site_playground", {
    ...persisted.configuration,
    capabilities: original.capabilities,
  });
  assert(
    restoredCaps.configuration.version === disabledVersion + 1,
    "Capability rollback must be a new version",
  );
  const converged = await waitForCapabilities(
    "site_playground",
    restoredCaps.configuration.version,
  );

  const browserContext = await browser.newContext();
  page = await browserContext.newPage();
  await page.goto(`${dashboardUrl}/dashboard/settings/capabilities?site_id=site_playground`);
  await page.getByRole("heading", { name: "Site capabilities" }).waitFor();
  await expect(page.getByRole("checkbox", { name: "Enable Geo country" })).toBeChecked();
  await expect(
    page.getByText(`Stored version ${converged.configuration.version}`, { exact: true }),
  ).toBeVisible();
  await page.goto(
    `${dashboardUrl}/dashboard/settings/environments?site_id=site_playground&environment=${environment}`,
  );
  await page.getByRole("heading", { name: "Website access" }).waitFor();
  const websiteAccess = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "Website access" }) });
  await expect(websiteAccess.getByText("Runtime status: current", { exact: true })).toHaveCount(1);
  const currentPolicy = await json(
    await request(`/v1/admin/sites/site_playground/environments/${environment}/ingest-policy`),
    "Reading applied environment policy",
  );
  await expect(
    websiteAccess.getByText(`Stored version ${currentPolicy.policy.version}`, { exact: true }),
  ).toBeVisible();
  await page.close();
}

async function assertEventAndHistoryBoundaries() {
  await postPageView("site_playground", "1", 202, "2.125.160.217");
  await postPageView("site_alpha", "2");
  runProcessorOnce();
  assert(
    (await readCount("page_view_totals", "site_playground")) === 1,
    "Processor did not aggregate site_playground event",
  );
  assert(
    (await readCount("page_view_totals", "site_alpha")) === 1,
    "Processor did not aggregate site_alpha event",
  );
  const overview = await fetch(`${apiUrl}/v1/sites/site_playground/overview`);
  assert(overview.ok, `Analytics API overview failed (${overview.status})`);
  const report = await overview.json();
  assert(report.page_views === 1, "Analytics API leaked or omitted another site's facts");

  const beforeDisable = await json(
    await request("/v1/admin/sites/site_playground/capabilities"),
    "Reading capabilities before history test",
  );
  const geoFactsBeforeDisable = await readCount("geo_country_facts", "site_playground");
  assert(
    geoFactsBeforeDisable > 0,
    "Enabled Geo capability did not create its positive-control fact",
  );
  const disabled = structuredClone(beforeDisable.configuration.capabilities);
  disabled.geo.enabled = false;
  const update = await putCapabilities("site_playground", {
    ...beforeDisable.configuration,
    capabilities: disabled,
  });
  await waitForCapabilities("site_playground", update.configuration.version);
  await postPageView("site_playground", "3");
  runProcessorOnce();
  assert(
    (await readCount("geo_country_facts", "site_playground")) === geoFactsBeforeDisable,
    "Disabled Geo capability created new facts",
  );
  const { from, to } = historicalWindow();
  const historyResponse = await fetch(
    `${apiUrl}/v1/sites/site_playground/reports/${from}/${to}/overview`,
  );
  assert(
    historyResponse.ok,
    `Historical overview became unavailable while a capability was disabled (${historyResponse.status})`,
  );
  const history = await historyResponse.json();
  assert(history.page_views === 2, "Baseline Page View facts stopped while Geo was disabled");
  const restore = await putCapabilities("site_playground", {
    ...update.configuration,
    capabilities: beforeDisable.configuration.capabilities,
  });
  assert(
    restore.configuration.version === update.configuration.version + 1,
    "Re-enabling must create a new version",
  );
  await waitForCapabilities("site_playground", restore.configuration.version);
  runProcessorOnce();
  assert(
    (await readCount("geo_country_facts", "site_playground")) === geoFactsBeforeDisable,
    "Re-enabling Geo triggered an automatic historical backfill",
  );
}

async function assertStorageOutageRecovery() {
  const config = await json(
    await request("/v1/admin/sites/site_playground/capabilities"),
    "Reading capability snapshot before outage",
  );
  await waitForCapabilities("site_playground", config.configuration.version);
  runCompose(["stop", "postgres"]);
  try {
    // Wait for application refresh cycles and failed database queries to finish.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const health = await fetch(`${collectorUrl}/health`);
    assert(health.ok, "Collector did not remain available during configuration storage outage");
    const logs = runCompose(["logs", "--no-color", "collector", "processor", "analytics-api"], {
      capture: true,
    });
    assert(
      logs.includes("configuration refresh failed; retaining last valid Collector policy"),
      "Collector did not report retaining its last valid policy during storage outage",
    );
  } finally {
    runCompose(["start", "postgres"]);
  }
  await waitForHttpService("PostgreSQL", `${apiUrl}/health`);
  const converged = await waitForCapabilities("site_playground", config.configuration.version);
  assert(
    converged.effective_state.status === "current",
    "Runtime configuration did not recover after storage returned",
  );
}

async function main() {
  if (!managed) {
    prepareE2ECaches(root, "configuration");
    runCompose(["up", "--build", "-d", "--wait"]);
    seedE2ECapabilityConfigurations(runCompose);
  } else {
    runCompose([
      "up",
      "-d",
      "--wait",
      "--no-deps",
      "collector",
      "analytics-api",
      "processor",
      "dashboard",
    ]);
  }
  await waitForHttpService("Analytics API", `${apiUrl}/health`);
  await waitForHttpService("Collector", `${collectorUrl}/health`);
  await waitForHttpService("Dashboard", `${dashboardUrl}/dashboard`);
  await setupPolicies();
  await assertConfigurationWorkflow();
  await assertEventAndHistoryBoundaries();
  await assertStorageOutageRecovery();
  console.log("Configuration E2E workflow passed.");
}

try {
  await mkdir(artifactDirectory, { recursive: true });
  browser = await chromium.launch({ headless: true });
  await main();
} catch (error) {
  try {
    await captureE2EComposeDiagnostics({
      runCompose,
      artifactDirectory,
      includeConfig: false,
      services: ["collector", "processor", "analytics-api", "dashboard", "postgres", "db-migrate"],
    });
  } catch (artifactError) {
    console.error(`Could not capture Compose diagnostics: ${artifactError}`);
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (!managed) removeE2EComposeProject(runCompose);
}
