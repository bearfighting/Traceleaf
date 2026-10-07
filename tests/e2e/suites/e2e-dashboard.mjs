/* global console, fetch, process, setTimeout, window, localStorage, document */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

import { seedE2ECapabilityConfigurations } from "../support/e2e-capabilities.mjs";
import { initializeNodeOwnedVolume, prepareE2ECaches } from "../support/e2e-cache.mjs";
import {
  captureE2EComposeDiagnostics,
  createE2EComposeRunner,
  e2ePort,
  migrateE2EDatabase,
  removeE2EComposeProject,
  waitForHttpService,
} from "../support/e2e-compose.mjs";
import { resetE2EBusinessData } from "../support/e2e-database.mjs";
import { seedE2EIngestPolicies } from "../support/e2e-ingest-policies.mjs";
import { runEventScenario } from "./dashboard/events.mjs";
import { runReportScenario } from "./dashboard/reports.mjs";
import { runSettingsScenario } from "./dashboard/settings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const importedDefinitionVersion = JSON.parse(
  await readFile(path.join(root, "config/analytics-definitions.json"), "utf8"),
).version;
const managed = Boolean(process.env.E2E_SHARED_PROJECT);
const project = process.env.E2E_SHARED_PROJECT ?? `web-analytics-dashboard-e2e-${process.pid}`;
const adminToken = process.env.E2E_ADMIN_TOKEN ?? randomBytes(32).toString("base64url");
const dashboardUrl = `http://127.0.0.1:${e2ePort("DASHBOARD_PORT", 13000)}`;
const playgroundUrl = `http://localhost:${e2ePort("PLAYGROUND_NEXT_PORT", 3000)}`;
const errorDashboardPort = e2ePort("DASHBOARD_ERROR_E2E_PORT", 13001);
const errorContainer = `${project}-dashboard-error`;
const collectorUrl = `http://127.0.0.1:${e2ePort("E2E_COLLECTOR_PORT", 14001)}`;
const analyticsUrl = `http://127.0.0.1:${e2ePort("E2E_ANALYTICS_API_PORT", 14002)}`;
const fixturesDirectory = path.join(
  root,
  "protocol",
  "contracts",
  "analytics-api",
  "current",
  "fixtures",
);
const audienceDimensionFixturesDirectory = path.join(
  root,
  "tests",
  "e2e",
  "suites",
  "dashboard",
  "fixtures",
);
const keys = {
  site_playground: process.env.E2E_INGEST_KEY_PLAYGROUND ?? "e2e-test-key",
  site_alpha: process.env.E2E_INGEST_KEY_ALPHA ?? "e2e-test-key-alpha",
  site_beta: process.env.E2E_INGEST_KEY_BETA ?? "e2e-test-key-beta",
};

const { runCompose } = createE2EComposeRunner({
  root,
  project,
  profiles: ["backend", "storage", "processing", "dashboard", "playground-next"],
});

const fixture = async (name) =>
  JSON.parse(await readFile(path.join(fixturesDirectory, `${name}.json`), "utf8"));
const audienceDimensionFixture = async (name) =>
  JSON.parse(await readFile(path.join(audienceDimensionFixturesDirectory, `${name}.json`), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertSettingsSectionFitsViewport(page, section, label) {
  const viewportWidth = page.viewportSize().width;
  const bounds = await section.boundingBox();
  assert(
    bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewportWidth,
    `${label} exceeds the ${viewportWidth}px viewport`,
  );
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  assert(!horizontalOverflow, `${label} causes horizontal page overflow at ${viewportWidth}px`);
}

function assertDashboardIsolation() {
  const config = runCompose(["config"], { capture: true });
  const dashboardMatch = config.match(
    /\n\x20{2}dashboard:\n[\s\S]*?(?=\n\x20{2}[a-zA-Z0-9_-]+:|\nnetworks:|\nvolumes:)/,
  );
  assert(dashboardMatch, "Dashboard service is missing from Compose config");
  const dashboardConfig = dashboardMatch[0];
  assert(
    !/DATABASE_URL|postgres/i.test(dashboardConfig),
    "Dashboard Compose service must not connect to PostgreSQL",
  );
}

function expectedApi(data, name) {
  const response = data.expected?.api?.[name];
  assert(response?.status === 200, `Fixture is missing a successful ${name} API response`);
  return response.body;
}

function expectedSiteReport(data, siteId, from, to) {
  const daily = data.expected.page_view_daily.filter(
    (item) => item.site_id === siteId && item.day >= from && item.day <= to,
  );
  const routes = data.expected.page_view_routes
    .filter((item) => item.site_id === siteId && item.day >= from && item.day <= to)
    .reduce((items, item) => {
      const existing = items.find((candidate) => candidate.path === item.path);
      if (existing) existing.page_views += item.page_views;
      else items.push({ path: item.path, page_views: item.page_views });
      return items;
    }, [])
    .sort(
      (left, right) => right.page_views - left.page_views || left.path.localeCompare(right.path),
    );
  const pageViews =
    data.expected.page_view_totals.find((item) => item.site_id === siteId)?.page_views ?? 0;

  return {
    overview: { site_id: siteId, page_views: pageViews },
    rangeOverview: {
      site_id: siteId,
      from,
      to,
      page_views: daily.reduce((total, item) => total + item.page_views, 0),
    },
    timeline: {
      site_id: siteId,
      from,
      to,
      items: daily.map(({ day, page_views }) => ({ day, page_views })),
    },
    pages: { site_id: siteId, from, to, items: routes },
  };
}

async function assertDashboardRuntimeConfiguration() {
  const output = runCompose(
    ["exec", "-T", "dashboard", "sh", "-c", 'printf %s "$ANALYTICS_API_URL"'],
    { capture: true },
  ).trim();
  const expected = process.env.DASHBOARD_ANALYTICS_API_URL ?? "http://analytics-api:4002";
  assert(output === expected, `Dashboard is configured with ${output}, expected ${expected}`);
}

async function enableAudienceDimensionReports(siteId) {
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
    `INSERT INTO analytics_feature_flags (site_id, analytics_enabled) VALUES ('${siteId}', TRUE) ON CONFLICT (site_id) DO UPDATE SET analytics_enabled = TRUE`,
  ]);
  await setAudienceDimensionReportsEnabled(siteId, true);
}

async function setAudienceDimensionReportsEnabled(siteId, enabled) {
  const enabledSql = enabled ? "TRUE" : "FALSE";
  const version = Number(
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
        `UPDATE site_capability_configurations
SET version = version + 1, updated_at = NOW(), document = jsonb_set(
  jsonb_set(
    jsonb_set(document, '{version}', to_jsonb(version + 1)),
    '{updated_at}', to_jsonb(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))
  ),
  '{capabilities}',
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(document->'capabilities', '{browser_context,enabled}', to_jsonb(${enabledSql})),
        '{anonymous_visitors,enabled}', to_jsonb(${enabledSql})
      ),
      '{sessions,enabled}', to_jsonb(${enabledSql})
    ),
    '{dimensions,enabled}', to_jsonb(${enabledSql})
  )
)
WHERE site_id = '${siteId}'
RETURNING version`,
      ],
      { capture: true },
    )
      .trim()
      .split(/\r?\n/, 1)[0],
  );
  if (!Number.isInteger(version)) throw new Error(`Could not update capabilities for ${siteId}`);

  const windowSql = enabled
    ? `INSERT INTO site_capability_activation_windows (site_id, capability_id, enabled_since)
SELECT '${siteId}', capability_id, '0001-01-01T00:00:00Z'::timestamptz
FROM unnest(ARRAY['browser_context', 'anonymous_visitors', 'sessions', 'dimensions']) AS capabilities(capability_id)
ON CONFLICT (site_id, capability_id) DO UPDATE SET enabled_since = EXCLUDED.enabled_since`
    : `DELETE FROM site_capability_activation_windows WHERE site_id = '${siteId}' AND capability_id IN ('browser_context', 'anonymous_visitors', 'sessions', 'dimensions')`;
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
    windowSql,
  ]);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const applied = runCompose(
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
        `SELECT COUNT(DISTINCT service) = 2 FROM configuration_capability_runtime_state WHERE service IN ('collector', 'analytics_api') AND site_id = '${siteId}' AND applied_version = ${version} AND refresh_status = 'current' AND last_seen_at >= NOW() - INTERVAL '15 seconds'`,
      ],
      { capture: true },
    ).trim();
    if (applied === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Collector and Analytics API did not apply capability version ${version} for ${siteId}`,
  );
}

async function postFixtureEvents(input) {
  for (const siteId of new Set(input.events.map((event) => event.site_id))) {
    const events = input.events.filter((event) => event.site_id === siteId);
    for (const event of input.geo_forwarded_for ? events : [null]) {
      const batch = event ? [event] : events;
      const response = await fetch(`${collectorUrl}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: playgroundUrl,
          "x-ingest-key": keys[siteId],
          ...(event ? { "x-forwarded-for": input.geo_forwarded_for[event.event_id] } : {}),
        },
        body: JSON.stringify({ schema_version: 1, events: batch }),
      });
      const body = await response.json();
      assert(response.status === 202, `Collector rejected events: ${JSON.stringify(body)}`);
      assert(
        body.accepted === batch.length,
        `Collector accepted ${body.accepted}, expected ${batch.length}`,
      );
    }
  }
}

async function postDimensionFixtureEvents(input) {
  for (const siteId of new Set(input.events.map((event) => event.site_id))) {
    const events = input.events.filter((event) => event.site_id === siteId);
    const response = await fetch(`${collectorUrl}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: playgroundUrl,
        "x-ingest-key": keys[siteId],
      },
      body: JSON.stringify({ schema_version: 1, events }),
    });
    const body = await response.json();
    assert(response.status === 202, `Collector rejected dimension events: ${JSON.stringify(body)}`);
    assert(
      body.accepted === events.length,
      `Collector accepted ${body.accepted} dimension events, expected ${events.length}`,
    );
  }
}

function importDefinitionsIfEmpty() {
  runCompose(
    [
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
      "--import-definitions-if-empty",
    ],
    { capture: true },
  );
}

function runProcessorOnce() {
  runCompose(
    [
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
    ],
    { capture: true },
  );
}

function runProcessorRebuildConversionFunnels(siteId, definitionVersion) {
  runCompose(
    [
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
      "--rebuild-conversion-funnels",
      "--site-id",
      siteId,
      "--definition-version",
      definitionVersion,
    ],
    { capture: true },
  );
}

function runProcessorRebuildCustomEvents(siteId) {
  runCompose(
    [
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
      "--rebuild-custom-events",
      "--site-id",
      siteId,
    ],
    { capture: true },
  );
}

function runProcessorBackfill(from, to) {
  runCompose(
    [
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
      "--backfill",
      "--site-id",
      "site_playground",
      "--from",
      from,
      "--to",
      to,
    ],
    { capture: true },
  );
}

async function prepareFixture(data) {
  resetE2EBusinessData({ runCompose, project, scope: "dashboard" });
  await postFixtureEvents(data.input);
  runProcessorOnce();
}

async function prepareAudienceDimensionFixture(data) {
  resetE2EBusinessData({ runCompose, project, scope: "dashboard" });
  await enableAudienceDimensionReports("site_playground");
  await postDimensionFixtureEvents(data.input);
  runProcessorOnce();
  runProcessorBackfill("2026-09-20", "2026-09-21");
}

function rangeUrl(siteId, from, to, report = "") {
  return `${dashboardUrl}/dashboard${report ? `/${report}` : ""}?site_id=${siteId}&from=${from}&to=${to}`;
}

async function expectMetric(page, label, value) {
  const card = page.locator("article.card").filter({ hasText: label });
  await card
    .locator(".metric")
    .filter({ hasText: String(value) })
    .waitFor();
}

async function expectReportRows(page, sectionName, rows) {
  await page.waitForFunction(
    ({ sectionName: expectedSectionName, expectedRows }) => {
      const heading = Array.from(document.querySelectorAll("h2")).find(
        (element) => element.textContent?.trim() === expectedSectionName,
      );
      const section = heading?.closest("section.card");
      if (!section) return false;

      const actualRows = Array.from(section.querySelectorAll("tbody tr"), (row) =>
        Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "").join(" "),
      );
      return JSON.stringify(actualRows) === JSON.stringify(expectedRows);
    },
    { sectionName, expectedRows: rows },
  );

  const heading = page.getByRole("heading", { name: sectionName, exact: true, level: 2 });
  await heading.waitFor();
  const section = page.locator("section.card").filter({ has: heading });
  const actual = await section
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "").join(" "),
      ),
    );
  assert(
    JSON.stringify(actual) === JSON.stringify(rows),
    `${sectionName} rows mismatch: ${JSON.stringify(actual)}`,
  );
}

async function assertBrowserWebVitalsCollection(browser) {
  resetE2EBusinessData({ runCompose, project, scope: "dashboard" });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.keepalive) localStorage.setItem("__e2e_web_vitals_keepalive", "true");
      return nativeFetch(input, init);
    };
  });

  try {
    await page.goto(playgroundUrl, { waitUntil: "domcontentloaded" });
    const navigationLog = page.getByTestId("events-json");
    await navigationLog.waitFor();
    await page.waitForFunction(() => {
      const value = document.querySelector("[data-testid=events-json]")?.textContent ?? "[]";
      return value.includes("initial");
    });
    await page.waitForTimeout(1200);
    await page.goto(`${playgroundUrl}/about`, { waitUntil: "domcontentloaded" });
    assert(
      (await page.evaluate(() => localStorage.getItem("__e2e_web_vitals_keepalive"))) === "true",
      "The real Browser SDK did not issue a keepalive request when the document was hidden",
    );

    const deadline = Date.now() + 15_000;
    let payloads = [];
    while (Date.now() < deadline) {
      payloads = readBrowserEvents();
      if (payloads.some((event) => event.type === "web_vital")) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const pageViews = new Map(
      payloads
        .filter((event) => event.type === "page_view")
        .map((event) => [event.event_id, event]),
    );
    const vitals = payloads.filter((event) => event.type === "web_vital");
    assert(vitals.length > 0, "The browser did not deliver any Web Vital events to the Collector");
    for (const event of vitals) {
      const pageView = pageViews.get(event.page_view_event_id);
      assert(pageView, `Web Vital ${event.event_id} is missing its Page View`);
      assert(
        event.path === pageView.path &&
          event.page_view_occurred_at === pageView.occurred_at &&
          event.occurred_at >= pageView.occurred_at,
        `Web Vital ${event.event_id} does not match its Page View fields`,
      );
      assert(
        ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(event.metric),
        `Unexpected browser metric ${event.metric}`,
      );
      const max = event.metric === "CLS" ? 100 : 600_000;
      assert(
        Number.isFinite(event.value) && event.value >= 0 && event.value <= max,
        "Browser Web Vital value is outside protocol bounds",
      );
      assert(
        Number.isInteger(event.report_sequence) && event.report_sequence > 0,
        "Browser Web Vital report sequence is invalid",
      );
    }

    runCompose(
      [
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
      ],
      { capture: true },
    );
    const factCount = Number(
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
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "SELECT COUNT(*) FROM web_vital_facts WHERE site_id='site_playground'",
        ],
        { capture: true },
      ).trim(),
    );
    assert(factCount > 0, "Processor did not persist browser Web Vital facts");

    const reportDate = new Date(pageViews.get(vitals[0].page_view_event_id).occurred_at)
      .toISOString()
      .slice(0, 10);
    const reportResponse = await fetch(
      `${analyticsUrl}/v1/sites/site_playground/reports/${reportDate}/${reportDate}/web-vitals`,
    );
    const report = await reportResponse.json();
    assert(
      reportResponse.status === 200,
      `Analytics API rejected browser Web Vitals: ${JSON.stringify(report)}`,
    );
    assert(
      report.total === factCount &&
        report.items.reduce((sum, item) => sum + item.count, 0) === factCount,
      "Analytics API total does not include all processed browser samples",
    );
    assert(
      vitals.every((event) =>
        report.items.some((item) => item.path === event.path && item.metric === event.metric),
      ),
      "Analytics API is missing browser generated Web Vital metrics",
    );
  } finally {
    await context.close();
  }
}

function readBrowserEvents() {
  const output = runCompose(
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "analytics",
      "-d",
      "analytics",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT COALESCE(json_agg(payload ORDER BY id), '[]'::json)::text FROM raw_events WHERE site_id='site_playground'",
    ],
    { capture: true },
  );
  return JSON.parse(output.trim());
}

let browser;
let browserContext;
let page;
let browserTracingActive = false;
try {
  const artifactDirectory = path.join(root, "artifacts", "dashboard-e2e");
  await rm(artifactDirectory, { recursive: true, force: true });
  if (!managed) prepareE2ECaches(root, "dashboard");
  assertDashboardIsolation();
  if (!managed) {
    await runCompose(["up", "-d", "--build", "--wait", "postgres"]);
    migrateE2EDatabase(runCompose);
    seedE2ECapabilityConfigurations(runCompose);
  }
  seedE2EIngestPolicies(runCompose, keys, [playgroundUrl]);
  importDefinitionsIfEmpty();
  const composeOutput = runCompose(
    [
      "up",
      "-d",
      ...(!managed ? ["--build"] : []),
      "--wait",
      ...(managed ? ["--no-deps"] : []),
      ...(!managed ? ["postgres"] : []),
      "collector",
      "analytics-api",
      "dashboard",
      "playground-next",
      "dashboard-api-error",
    ],
    {
      capture: true,
      env: {
        NEXT_PUBLIC_ANALYTICS_TRANSPORT: "fetch",
        NEXT_PUBLIC_ANALYTICS_ENDPOINT: `${collectorUrl}/v1/events`,
        NEXT_PUBLIC_ANALYTICS_INGEST_KEY: keys.site_playground,
        NEXT_PUBLIC_ANALYTICS_SITE_ID: "site_playground",
        CONFIG_ADMIN_TOKENS: JSON.stringify([adminToken]),
        DASHBOARD_CONFIG_ADMIN_TOKEN: adminToken,
        DASHBOARD_DEFAULT_ENVIRONMENT: managed ? "e2e" : "config-e2e",
      },
    },
  );
  process.stdout.write(composeOutput);
  await waitForHttpService("Dashboard", `${dashboardUrl}/dashboard`);
  await waitForHttpService("Next.js browser playground", playgroundUrl);
  await assertDashboardRuntimeConfiguration();
  browser = await chromium.launch({ headless: true });
  await assertBrowserWebVitalsCollection(browser);
  console.log("PASS real-browser Web Vitals collection and keepalive ingestion");
  browserContext = await browser.newContext();
  await browserContext.tracing.start({ screenshots: true, snapshots: true });
  browserTracingActive = true;
  page = await browserContext.newPage();

  const reportContext = {
    page,
    assert,
    dashboardUrl,
    fixture,
    prepareFixture,
    expectedApi,
    rangeUrl,
    expectMetric,
    expectReportRows,
    expectedSiteReport,
    project,
    runCompose,
    resetE2EBusinessData,
    setAudienceDimensionReportsEnabled,
    postFixtureEvents,
    runProcessorOnce,
    audienceDimensionFixture,
    prepareAudienceDimensionFixture,
    assertSettingsSectionFitsViewport,
  };
  const eventContext = {
    page,
    assert,
    fixture,
    prepareFixture,
    expectedApi,
    rangeUrl,
    expectMetric,
    expectReportRows,
    audienceDimensionFixture,
    enableAudienceDimensionReports,
    runProcessorBackfill,
    runProcessorRebuildConversionFunnels,
    runProcessorRebuildCustomEvents,
    importedDefinitionVersion,
    runCompose,
    analyticsUrl,
  };
  const settingsContext = {
    page,
    browser,
    browserContext,
    assert,
    dashboardUrl,
    assertSettingsSectionFitsViewport,
    runCompose,
    importedDefinitionVersion,
    adminToken,
    analyticsUrl,
    project,
    root,
    execFileSync,
    initializeNodeOwnedVolume,
    errorContainer,
    errorDashboardPort,
    waitForHttpService,
  };
  await runReportScenario(reportContext, "shell");
  console.log(
    "PASS responsive Dashboard shell, report anchors, filter context, and keyboard navigation",
  );
  await runReportScenario(reportContext, "singlePageView");
  console.log("PASS single-page-view dashboard");
  await runReportScenario(reportContext, "geoCountries");
  console.log("PASS geo-countries dashboard");
  await runEventScenario(eventContext, "customEvents");
  console.log("PASS custom-events dashboard");
  await runEventScenario(eventContext, "conversionFunnels");
  console.log("PASS backfilled conversion and funnel dashboard");
  await runSettingsScenario(settingsContext, "definitions");
  console.log(
    "PASS versioned Conversion/Funnel editing, history retention, and no automatic backfill",
  );
  await runEventScenario(eventContext, "webVitals");
  console.log("PASS web-vitals dashboard");
  await runReportScenario(reportContext, "multiPageNavigation");
  console.log("PASS multi-page-navigation dashboard");
  await runReportScenario(reportContext, "multiSiteIsolation");
  console.log("PASS multi-site-isolation dashboard");
  await runReportScenario(reportContext, "emptyRange");
  console.log("PASS empty-date-range dashboard");
  await runReportScenario(reportContext, "customDateRange");
  console.log("PASS custom-date-range dashboard");
  await runReportScenario(reportContext, "audienceDimensionsDisabled");
  console.log("PASS audience-dimension-reports-disabled dashboard");
  await runReportScenario(reportContext, "audienceDimensions");
  console.log("PASS audience-dimension dashboard");
  await runReportScenario(reportContext, "audienceDimensionsEmpty");
  console.log("PASS audience-dimension-empty dashboard");
  await browserContext.tracing.stop();
  browserTracingActive = false;
  await runSettingsScenario(settingsContext, "configuration");
  console.log(
    "PASS dashboard configuration, policy enablement, one-time key display, rotation, and revocation",
  );
  await runSettingsScenario(settingsContext, "apiError");
  console.log("PASS api-error dashboard");
  await page.close();
  console.log("Dashboard E2E workflow passed.");
} catch (error) {
  const artifactDirectory = path.join(root, "artifacts", "dashboard-e2e");
  await mkdir(artifactDirectory, { recursive: true });
  if (page) {
    try {
      await page.evaluate(() => {
        document.querySelectorAll(".one-time-secret").forEach((element) => element.remove());
      });
      await page.screenshot({ path: path.join(artifactDirectory, "failure.png"), fullPage: true });
    } catch (artifactError) {
      console.error(`Dashboard failure screenshot could not be saved: ${artifactError}`);
    }
  }
  if (browserContext && browserTracingActive) {
    try {
      await browserContext.tracing.stop({ path: path.join(artifactDirectory, "trace.zip") });
      browserTracingActive = false;
    } catch (artifactError) {
      console.error(`Dashboard trace could not be saved: ${artifactError}`);
    }
  }
  try {
    await captureE2EComposeDiagnostics({
      runCompose,
      artifactDirectory,
      services: [
        "dashboard",
        "playground-next",
        "collector",
        "analytics-api",
        "postgres",
        "db-migrate",
        "dashboard-api-error",
      ],
      transformConfig: redactAdminToken,
      configOptions: {
        env: {
          CONFIG_ADMIN_TOKENS: JSON.stringify([adminToken]),
          DASHBOARD_CONFIG_ADMIN_TOKEN: adminToken,
          DASHBOARD_DEFAULT_ENVIRONMENT: managed ? "e2e" : "config-e2e",
        },
      },
    });
    console.error(`Dashboard E2E artifacts saved in ${artifactDirectory}`);
  } catch (artifactError) {
    console.error(`Dashboard Compose diagnostics could not be saved: ${artifactError}`);
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  if (browserContext) await browserContext.close();
  if (browser) await browser.close();
  if (!managed) removeE2EComposeProject(runCompose);
}

function redactAdminToken(value) {
  return value.split(adminToken).join("[REDACTED]");
}
