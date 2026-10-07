/* global console, fetch, process, setTimeout */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { ulid } from "ulid";

import { captureE2EComposeDiagnostics } from "../support/e2e-compose.mjs";
import { prepareE2ECaches } from "../support/e2e-cache.mjs";
import {
  createE2EComposeRunner,
  e2ePort,
  migrateE2EDatabase,
  removeE2EComposeProject,
  waitForHttpService,
} from "../support/e2e-compose.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const project =
  process.env.E2E_ONBOARDING_PROJECT ?? `web-analytics-site-onboarding-e2e-${process.pid}`;
const token = randomBytes(32).toString("base64url");
const dashboardPort = e2ePort("E2E_ONBOARDING_DASHBOARD_PORT", 13144);
const collectorPort = e2ePort("E2E_ONBOARDING_COLLECTOR_PORT", 14044);
const apiPort = e2ePort("E2E_ONBOARDING_API_PORT", 14045);
const postgresPort = e2ePort("E2E_ONBOARDING_POSTGRES_PORT", 15444);
const playgroundPort = e2ePort("E2E_ONBOARDING_PLAYGROUND_PORT", 13044);
const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const collectorUrl = `http://127.0.0.1:${collectorPort}`;
const playgroundUrl = `http://localhost:${playgroundPort}`;
const { runCompose: compose } = createE2EComposeRunner({
  root,
  project,
  profiles: ["storage", "backend", "processing", "dashboard", "playground-next"],
  env: {
    CONFIG_ADMIN_TOKENS: JSON.stringify([token]),
    DASHBOARD_CONFIG_ADMIN_TOKEN: token,
    DASHBOARD_DEFAULT_ENVIRONMENT: "production",
    DASHBOARD_PORT: dashboardPort,
    E2E_DASHBOARD_PORT: dashboardPort,
    E2E_ANALYTICS_API_PORT: apiPort,
    E2E_COLLECTOR_PORT: collectorPort,
    E2E_POSTGRES_PORT: postgresPort,
    PLAYGROUND_NEXT_PORT: playgroundPort,
    NEXT_PUBLIC_ANALYTICS_TRANSPORT: "fetch",
    NEXT_PUBLIC_ANALYTICS_ENDPOINT: `${collectorUrl}/v1/events`,
    PLAYGROUND_ORIGINS: playgroundUrl,
  },
});

function query(sql) {
  return compose(
    ["exec", "-T", "postgres", "psql", "-U", "analytics", "-d", "analytics", "-At", "-c", sql],
    { capture: true },
  ).trim();
}

async function waitForRuntime(siteId, endpoint, label) {
  const deadline = Date.now() + 60_000;
  let current = "unavailable";
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const body = await response.json();
      current = body.effective_state?.status ?? "missing";
      if (current === "current") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not converge to current (last state: ${current}, site: ${siteId})`);
}

async function waitForCollectorCapabilities(siteId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const applied = query(
      `SELECT count(*) FROM configuration_capability_runtime_state AS runtime JOIN site_capability_configurations AS stored USING (site_id) WHERE runtime.service = 'collector' AND runtime.site_id = '${siteId}' AND runtime.refresh_status = 'current' AND runtime.applied_version = stored.version`,
    );
    if (Number(applied) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Collector did not apply capabilities for ${siteId}`);
}

async function assertDashboardOperationalErrors(browser) {
  const cases = [
    {
      name: "missing management credentials",
      env: { DASHBOARD_CONFIG_ADMIN_TOKEN: "" },
      text: /not configured|management.*credential|admin token/i,
    },
    {
      name: "invalid management credentials",
      env: { DASHBOARD_CONFIG_ADMIN_TOKEN: "invalid-e2e-token" },
      text: /unauthorized|not authorized|permission|401|invalid.*credential/i,
    },
    {
      name: "unavailable Site Management API",
      env: { DASHBOARD_SITE_MANAGEMENT_API_URL: "http://127.0.0.1:1" },
      text: /unavailable|failed|connect/i,
    },
  ];
  for (const scenario of cases) {
    console.log(`Checking Dashboard state: ${scenario.name}`);
    compose(["up", "-d", "--no-deps", "--force-recreate", "dashboard"], {
      capture: true,
      env: { DASHBOARD_CONFIG_ADMIN_TOKEN: token, ...scenario.env },
    });
    await waitForHttpService(scenario.name, `${dashboardUrl}/dashboard`, { timeoutMs: 360_000 });
    const page = await browser.newPage();
    await page.goto(`${dashboardUrl}/dashboard`);
    const status = page.locator('[aria-label="Site directory status"]');
    await status.waitFor();
    const text = await status.innerText();
    assert.match(
      text,
      scenario.text,
      `${scenario.name} should render its operational state: ${text}`,
    );
    assert.doesNotMatch(text, /No Sites registered/i, `${scenario.name} must not appear empty`);
    await page.close();
    console.log(`PASS Dashboard state: ${scenario.name}`);
  }
}

async function main() {
  prepareE2ECaches(root, "site-onboarding");
  compose(["up", "-d", "--build", "--wait", "postgres"]);
  migrateE2EDatabase(compose);
  compose([
    "up",
    "-d",
    "--build",
    "--wait",
    "collector",
    "analytics-api",
    "processor",
    "dashboard",
  ]);
  assert.equal(
    query("SELECT count(*) FROM site_registry"),
    "0",
    "onboarding E2E must start with an empty registry",
  );
  await waitForHttpService("Dashboard", `${dashboardUrl}/dashboard`, { timeoutMs: 360_000 });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${dashboardUrl}/dashboard`);
    await page.getByText("No Sites registered").waitFor();
    await page
      .getByRole("region", { name: "Site directory status" })
      .getByRole("link", { name: /Add a Site/i })
      .click();
    await page.getByLabel("Site name").fill("Onboarding E2E Site");
    await page.getByLabel("Website URL").fill(playgroundUrl);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("web vitals").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Create Site/i }).click();
    await page.getByRole("heading", { name: "Site created" }).waitFor();

    const result = page.getByRole("region", { name: "Site creation result" });
    const resultText = await result.innerText();
    const siteId = resultText.match(/Site ID:\s*(\S+)/)?.[1];
    const key = result.locator("code").nth(2);
    const ingestKey = (await key.innerText()).trim();
    assert(
      siteId && ingestKey,
      "Dashboard creation result must expose the Site ID and one-time key",
    );
    assert(!page.url().includes(ingestKey), "Ingest Key must not appear in URL");
    assert.equal(
      await page.evaluate((value) => {
        const entries = [localStorage, sessionStorage].flatMap((storage) =>
          Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index);
            return [key, key === null ? null : storage.getItem(key)];
          }),
        );
        return entries.some((entry) => entry?.includes(value));
      }, ingestKey),
      false,
      "Ingest Key must not enter browser storage",
    );

    await waitForRuntime(siteId, `/v1/admin/sites/${siteId}/capabilities`, "Capabilities");
    await waitForRuntime(
      siteId,
      `/v1/admin/sites/${siteId}/environments/production/ingest-policy`,
      "Ingest policy",
    );
    await waitForCollectorCapabilities(siteId);
    compose(["up", "-d", "--build", "--wait", "--force-recreate", "playground-next"], {
      env: { NEXT_PUBLIC_ANALYTICS_SITE_ID: siteId, NEXT_PUBLIC_ANALYTICS_INGEST_KEY: ingestKey },
    });
    await waitForHttpService("Next.js Playground", `${playgroundUrl}/`, {
      timeoutMs: 360_000,
    });
    const observed = await browser.newPage();
    const sdkRequests = [];
    observed.on("request", (request) => {
      if (request.url() === `${collectorUrl}/v1/events`) {
        sdkRequests.push({ method: request.method(), body: request.postData() });
      }
    });
    observed.on("response", async (response) => {
      if (response.url() === `${collectorUrl}/v1/events`) {
        sdkRequests.push({
          status: response.status(),
          body: await response.text().catch(() => ""),
        });
      }
    });
    await observed.goto(`${playgroundUrl}/`);
    await observed.getByRole("link", { name: "About via Link" }).click();
    await observed.waitForURL("**/about");

    const deadline = Date.now() + 45_000;
    while (
      Date.now() < deadline &&
      query(`SELECT count(*) FROM raw_events WHERE site_id = '${siteId}'`) === "0"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const rawCount = query(`SELECT count(*) FROM raw_events WHERE site_id = '${siteId}'`);
    assert(
      Number(rawCount) >= 1,
      `Browser SDK Page Views were not ingested (raw event count: ${rawCount}; SDK status: ${await observed.getByLabel("SDK workflow debug panel").innerText()}; requests: ${JSON.stringify(sdkRequests)})`,
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
      "once",
      "process",
    ]);

    const day = new Date().toISOString().slice(0, 10);
    const reportResponse = await fetch(`${apiUrl}/v1/sites/${siteId}/reports/${day}/${day}/pages`);
    const report = await reportResponse.json();
    assert(reportResponse.ok, `Analytics API report returned ${reportResponse.status}`);
    assert(
      report.items?.some((item) => item.path === "/about" && item.page_views >= 1),
      `Processed SDK Page View missing: ${JSON.stringify(report)}`,
    );

    await page.goto(
      `${dashboardUrl}/dashboard/settings?site_id=${encodeURIComponent(siteId)}&environment=production`,
    );
    const connectionStatus = page.getByLabel("Connection status");
    await connectionStatus.waitFor();
    const settingsText = await connectionStatus.innerText();
    assert.match(
      settingsText,
      /SITE PAGE VIEWS\s*[1-9][0-9]*/,
      `Settings did not show the received Page View count: ${settingsText}`,
    );
    console.log("PASS Settings shows the received Page View count");
    await assertDashboardOperationalErrors(browser);
    console.log(
      "PASS empty Dashboard onboarding, one-time key handling, Browser SDK ingest, runtime application, processing, Analytics API and Settings evidence",
    );
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  try {
    await captureE2EComposeDiagnostics({
      runCompose: compose,
      artifactDirectory: path.join(root, "artifacts", "site-onboarding-e2e"),
      services: [
        "postgres",
        "db-migrate",
        "collector",
        "analytics-api",
        "processor",
        "dashboard",
        "playground-next",
      ],
    });
  } catch (artifactError) {
    console.error(`Could not capture Compose diagnostics: ${artifactError}`);
  }
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  removeE2EComposeProject(compose);
}
