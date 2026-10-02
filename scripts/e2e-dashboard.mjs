/* global console, fetch, process, setTimeout, window, localStorage, document */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

import { seedE2ECapabilityConfigurations } from "./e2e-capabilities.mjs";
import { initializeNodeOwnedVolume, prepareE2ECaches } from "./e2e-cache.mjs";
import { seedE2EIngestPolicies } from "./e2e-ingest-policies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importedDefinitionVersion = JSON.parse(
  await readFile(path.join(root, "config/analytics-definitions.json"), "utf8"),
).version;
const composeFiles = ["-f", "compose.yaml", "-f", "compose.backend.yaml", "-f", "compose.e2e.yaml"];
const project = `web-analytics-dashboard-e2e-${process.pid}`;
const adminToken = randomBytes(32).toString("base64url");
const dashboardUrl = `http://127.0.0.1:${process.env.DASHBOARD_PORT ?? "13000"}`;
const errorDashboardPort = process.env.DASHBOARD_ERROR_E2E_PORT ?? "13001";
const errorContainer = `${project}-dashboard-error`;
const collectorUrl = `http://127.0.0.1:${process.env.E2E_COLLECTOR_PORT ?? "14001"}`;
const analyticsUrl = `http://127.0.0.1:${process.env.E2E_ANALYTICS_API_PORT ?? "14002"}`;
const fixturesDirectory = path.join(
  root,
  "protocol",
  "contracts",
  "analytics-api",
  "current",
  "fixtures",
);
const phase6FixturesDirectory = path.join(root, "tests", "fixtures", "dashboard");
const keys = {
  site_playground: "e2e-test-key",
  site_alpha: "e2e-test-key-alpha",
  site_beta: "e2e-test-key-beta",
};

const composeBaseArgs = [
  "compose",
  "-p",
  project,
  ...composeFiles,
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
];

const fixture = async (name) =>
  JSON.parse(await readFile(path.join(fixturesDirectory, `${name}.json`), "utf8"));
const phase6Fixture = async (name) =>
  JSON.parse(await readFile(path.join(phase6FixturesDirectory, `${name}.json`), "utf8"));

function runCompose(args, options = {}) {
  try {
    return execFileSync("docker", [...composeBaseArgs, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
  } catch (error) {
    if (options.allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`;

    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";
    const status = error.status == null ? "unknown" : String(error.status);
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      [
        `docker compose ${args.join(" ")} failed (exit code: ${status})`,
        output ? `Docker output:\n${output}` : "Docker produced no captured output.",
      ].join("\n"),
      { cause: error },
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function waitFor(label, url) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The service may still be compiling or starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function assertDashboardShell(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `${dashboardUrl}/dashboard?site_id=site_playground&from=2026-09-20&to=2026-09-21&dimension=browser`,
  );
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.locator(".analytics-sidebar-desktop")).toBeVisible();
  await expect(page.locator(".analytics-sidebar-desktop a[href='#overview']")).toHaveAttribute(
    "aria-current",
    "location",
  );

  await page.locator(".analytics-sidebar-desktop a[href='#timeline']").click();
  await expect(page).toHaveURL(
    /site_id=site_playground&from=2026-09-20&to=2026-09-21&dimension=browser#timeline$/,
  );
  await expect(page.locator("#timeline")).toBeInViewport();
  await expect(page.locator(".analytics-sidebar-desktop a[href='#timeline']")).toHaveAttribute(
    "aria-current",
    "location",
  );

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(
    /\/dashboard\/settings\?site_id=site_playground&from=2026-09-20&to=2026-09-21&dimension=browser/,
  );
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(
    /\/dashboard\?site_id=site_playground&from=2026-09-20&to=2026-09-21&dimension=browser/,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMenu = page.locator(".mobile-analytics-menu");
  await expect(mobileMenu).toBeVisible();
  await expect(page.locator(".analytics-sidebar-desktop")).toBeHidden();
  const summary = mobileMenu.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(mobileMenu).toHaveAttribute("open", "");
  const dimensionsLink = mobileMenu.getByRole("link", { name: "Dimensions" });
  await dimensionsLink.click();
  await expect(page).toHaveURL(/#dimensions$/);
  await expect(mobileMenu.locator("a[href='#dimensions']")).toHaveAttribute(
    "aria-current",
    "location",
  );
}

async function resetDatabase() {
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
    "TRUNCATE dimension_event_facts, dimension_daily, session_events, sessions, visitor_event_facts, visitor_daily, session_daily, normalized_event_context, web_vital_facts, analytics_rebuild_queue, analytics_watermarks, analytics_generations, analytics_feature_flags, raw_events, page_view_daily, page_view_routes, page_view_totals RESTART IDENTITY CASCADE",
  ]);
}

async function enablePhase6(siteId) {
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
  await setPhase6Enabled(siteId, true);
}

async function setPhase6Enabled(siteId, enabled) {
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
          origin: "http://localhost:3000",
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
        origin: "http://localhost:3000",
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
  await resetDatabase();
  await postFixtureEvents(data.input);
  runProcessorOnce();
}

async function preparePhase6Fixture(data) {
  await resetDatabase();
  await enablePhase6("site_playground");
  await postDimensionFixtureEvents(data.input);
  runProcessorOnce();
  runProcessorBackfill("2026-09-20", "2026-09-21");
}

function rangeUrl(siteId, from, to) {
  return `${dashboardUrl}/dashboard?site_id=${siteId}&from=${from}&to=${to}`;
}

async function expectMetric(page, label, value) {
  const card = page.locator("article.card").filter({ hasText: label });
  await card
    .locator(".metric")
    .filter({ hasText: String(value) })
    .waitFor();
}

async function expectReportRows(page, sectionName, rows) {
  const section = page.locator("section.card").filter({ hasText: sectionName });
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

async function assertGeoCountries(page) {
  const data = await fixture("geo-countries");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
  await expectReportRows(page, "Countries", ["GB 1", "Unknown 1"]);
  assert(
    !(await page.getByText(/Geo report data freshness:/).count()),
    "current Geo report should not display a warning state",
  );
  await page.getByText(/Earlier Page Views are not included/).waitFor();
  assert(
    (await page.getByRole("link", { name: "DB-IP" }).count()) === 0,
    "MaxMind-only range must not show DB-IP attribution",
  );
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
    "UPDATE geo_event_metadata SET provider='db-ip' WHERE raw_event_id=(SELECT raw_event_id FROM geo_country_facts WHERE site_id='site_playground' AND country_code='GB' LIMIT 1)",
  ]);
  await page.reload();
  await expect(page.getByRole("link", { name: "DB-IP" })).toHaveAttribute(
    "href",
    "https://db-ip.com",
  );
  await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01"));
  await page
    .locator("section.card")
    .filter({ hasText: "Countries" })
    .getByText("No page view data")
    .waitFor();
  assert(
    (await page.getByRole("link", { name: "DB-IP" }).count()) === 0,
    "empty range must not show DB-IP attribution",
  );
}

async function assertSinglePageView(page) {
  const data = await fixture("single-page-view");
  const overview = expectedApi(data, "overview");
  const rangeOverview = expectedApi(data, "range_overview");
  const timeline = expectedApi(data, "timeline");
  const pages = expectedApi(data, "pages");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
  await expectMetric(page, "Site total Page Views", overview.page_views);
  await expectMetric(page, "Selected range Page Views", rangeOverview.page_views);
  await expectReportRows(
    page,
    "Timeline",
    timeline.items.map((item) => `${item.day} ${item.page_views}`),
  );
  await expectReportRows(
    page,
    "Top Pages",
    pages.items.map((item) => `${item.path} ${item.page_views}`),
  );
}

async function assertBrowserWebVitalsCollection(browser) {
  await resetDatabase();
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
    await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
    const navigationLog = page.getByTestId("events-json");
    await navigationLog.waitFor();
    await page.waitForFunction(() => {
      const value = document.querySelector("[data-testid=events-json]")?.textContent ?? "[]";
      return value.includes("initial");
    });
    await page.waitForTimeout(1200);
    await page.goto("http://localhost:3000/about", { waitUntil: "domcontentloaded" });
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

async function assertWebVitals(page) {
  const data = await fixture("web-vitals");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
  const section = page.locator('section[aria-labelledby="web-vitals-heading"]');
  await expectReportRows(page, "Web Vitals", [
    "/vitals CLS 4 0.09 3 1 0",
    "/vitals FCP 4 1800 ms 3 1 0",
    "/vitals INP 4 200 ms 3 0 1",
    "/vitals LCP 4 2500 ms 3 0 1",
    "/vitals TTFB 4 800 ms 3 0 1",
  ]);
  assert(
    !(await section.textContent()).includes("properties"),
    "Web Vitals must not display properties",
  );
}

async function assertCustomEvents(page) {
  const data = await fixture("custom-events");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
  const section = page.locator("section.card").filter({ hasText: "Custom Events" });
  await section.getByText("2", { exact: true }).waitFor();
  await expectReportRows(page, "Custom Events", [
    "checkout_started 2026-09-18 1",
    "purchase_completed 2026-09-18 1",
  ]);
  const content = await section.textContent();
  assert(
    !content.includes("amount") && !content.includes("email"),
    "Custom event properties must not be displayed",
  );
  const conversions = page.locator("section.card").filter({ hasText: "Conversions" });
  await expectReportRows(page, "Conversions", ["purchase_completed 2026-09-18 1 0.0%"]);
  assert(
    !(await conversions.textContent()).includes("currency"),
    "Conversion properties must not be displayed",
  );
  const funnels = page.locator("section.card").filter({ hasText: "Funnels" });
  await funnels.getByText("No funnel data is available for this selection.").waitFor();
}

async function assertBackfilledConversionFunnels(page) {
  const data = await phase6Fixture("dashboard-dimensions");
  const visitorId = "550e8400-e29b-41d4-a716-446655440010";
  data.input.events.push(
    {
      schema_version: 1,
      event_id: "01J00000000000000000000606",
      type: "custom_event",
      site_id: "site_playground",
      visitor_id: visitorId,
      occurred_at: 1789945500000,
      event_name: "checkout_started",
      properties: { source: "product" },
    },
    {
      schema_version: 1,
      event_id: "01J00000000000000000000607",
      type: "custom_event",
      site_id: "site_playground",
      visitor_id: visitorId,
      occurred_at: 1789945800000,
      event_name: "purchase_completed",
      properties: { currency: "USD", amount: 49.95 },
    },
    {
      schema_version: 1,
      event_id: "01J00000000000000000000608",
      type: "custom_event",
      site_id: "site_playground",
      visitor_id: visitorId,
      occurred_at: 1789950000000,
      event_name: "session_boundary_probe",
      properties: {},
    },
  );

  // Process custom events before Sessions exist, then verify a direct Phase 6
  // backfill relinks the derived Conversion and Funnel facts.
  await prepareFixture(data);
  await enablePhase6("site_playground");
  runProcessorBackfill("2026-09-20", "2026-09-21");
  runProcessorRebuildConversionFunnels("site_playground", importedDefinitionVersion);
  await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21"));
  await expectReportRows(page, "Conversions", ["purchase_completed 2026-09-20 1 100.0%"]);
  await expectReportRows(page, "Funnels", [
    "checkout 2026-09-20 1 1 100.0%",
    "checkout 2026-09-20 2 1 100.0%",
  ]);

  const boundarySessionCount = runCompose(
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
      "SELECT COUNT(*) FROM custom_event_facts WHERE site_id='site_playground' AND event_id='01J00000000000000000000608' AND session_id IS NOT NULL",
    ],
    { capture: true },
  ).trim();
  assert(
    boundarySessionCount === "0",
    "Custom Events exactly 30 minutes after the last Page View must not join that Session",
  );

  runProcessorRebuildCustomEvents("site_playground");
  runProcessorRebuildConversionFunnels("site_playground", importedDefinitionVersion);
  for (const report of ["conversions", "funnels"]) {
    const response = await fetch(
      `${analyticsUrl}/v1/sites/site_playground/reports/2026-09-20/2026-09-21/${report}`,
    );
    const body = await response.json();
    assert(response.ok, `${report} rebuild request failed: ${JSON.stringify(body)}`);
    assert(
      body.freshness_status === "current",
      `${report} must remain current after custom-event facts are rebuilt`,
    );
  }
  const conversionAfterRebuild = await fetch(
    `${analyticsUrl}/v1/sites/site_playground/reports/2026-09-20/2026-09-21/conversions`,
  ).then((response) => response.json());
  assert(
    conversionAfterRebuild.items[0]?.eligible_sessions === 1 &&
      conversionAfterRebuild.items[0]?.converted_sessions === 1 &&
      conversionAfterRebuild.items[0]?.conversion_rate === 1,
    "Custom-event rebuild must restore Conversion session metrics",
  );

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
    `DELETE FROM definition_revision_watermarks WHERE site_id = 'site_playground' AND definition_version = '${importedDefinitionVersion}'`,
  ]);
  for (const report of ["conversions", "funnels"]) {
    const response = await fetch(
      `${analyticsUrl}/v1/sites/site_playground/reports/2026-09-20/2026-09-21/${report}`,
    );
    const body = await response.json();
    assert(response.ok, `${report} definition freshness request failed`);
    assert(
      body.freshness_status === "stale",
      `${report} must report stale when facts were built for another definition version`,
    );
  }

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
    "INSERT INTO analytics_rebuild_queue (site_id, scope_from, scope_to, aggregation_version, parser_version, rebuild_reason) VALUES ('site_playground', '2026-09-20', '2026-09-21', 1, 'e2e', 'incremental')",
  ]);
  for (const report of ["conversions", "funnels"]) {
    const response = await fetch(
      `${analyticsUrl}/v1/sites/site_playground/reports/2026-09-20/2026-09-21/${report}`,
    );
    const body = await response.json();
    assert(response.ok, `${report} freshness request failed: ${JSON.stringify(body)}`);
    assert(
      body.freshness_status === "rebuilding",
      `${report} must report rebuilding while a Session rebuild is pending`,
    );
  }
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
    "DELETE FROM analytics_rebuild_queue WHERE site_id = 'site_playground' AND parser_version = 'e2e'",
  ]);
}

async function assertMultiPageNavigation(page) {
  const data = await fixture("multi-page-navigation");
  const rangeOverview = expectedApi(data, "range_overview");
  const pages = expectedApi(data, "pages");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
  await expectMetric(page, "Selected range Page Views", rangeOverview.page_views);
  await expectReportRows(
    page,
    "Top Pages",
    pages.items.map((item) => `${item.path} ${item.page_views}`),
  );
}

async function assertMultiSiteIsolation(page) {
  const data = await fixture("multi-site-isolation");
  const alpha = {
    overview: expectedApi(data, "overview"),
    rangeOverview: expectedApi(data, "range_overview"),
    pages: expectedApi(data, "pages"),
  };
  const beta = expectedSiteReport(data, "site_beta", "2026-09-18", "2026-09-18");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_alpha", "2026-09-18", "2026-09-18"));
  await expectMetric(page, "Site total Page Views", alpha.overview.page_views);
  await page.locator('select[name="site_id"]').selectOption("site_beta");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/site_id=site_beta/);
  await expectMetric(page, "Selected range Page Views", beta.rangeOverview.page_views);
  await expectReportRows(
    page,
    "Top Pages",
    beta.pages.items.map((item) => `${item.path} ${item.page_views}`),
  );
}

async function assertEmptyRange(page) {
  const data = await fixture("empty-date-range");
  const rangeOverview = expectedApi(data, "range_overview");
  await prepareFixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01"));
  await expectMetric(page, "Selected range Page Views", rangeOverview.page_views);
  await page.getByText("No page view data is available for this selection.").nth(0).waitFor();
  await page
    .locator("section.card")
    .filter({ hasText: "Web Vitals" })
    .getByText("No page view data is available for this selection.")
    .waitFor();
  const emptyCopy = "No page view data is available for this selection.";
  assert(
    (await page
      .locator("section.card")
      .filter({ hasText: "Timeline" })
      .getByText(emptyCopy)
      .count()) === 1 &&
      (await page
        .locator("section.card")
        .filter({ hasText: "Top Pages" })
        .getByText(emptyCopy)
        .count()) === 1,
    "Expected empty states for Timeline and Top Pages",
  );
}

async function assertCustomDateRange(page) {
  const data = await fixture("single-page-view");
  const rangeOverview = expectedApi(data, "range_overview");
  await prepareFixture(data);
  await page.goto(`${dashboardUrl}/dashboard?site_id=site_playground`);
  await page.locator('input[name="from"]').fill("2026-09-18");
  await page.locator('input[name="to"]').fill("2026-09-18");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/from=2026-09-18&to=2026-09-18/);
  await expectMetric(page, "Selected range Page Views", rangeOverview.page_views);
}

async function assertPhase6Dashboard(page) {
  const data = await phase6Fixture("dashboard-dimensions");
  await preparePhase6Fixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21"));
  await expectMetric(page, "Unique Visitors", data.expected.visitors.unique_visitors);
  await expectMetric(page, "Sessions", data.expected.visitors.sessions);
  await expectReportRows(
    page,
    "Visitors and Sessions",
    data.expected.visitors.items.map(
      (item) => `${item.day} ${item.page_views} ${item.unique_visitors} ${item.sessions}`,
    ),
  );
  await expectReportRows(page, "Dimension Report", [
    `${data.expected.browser.value} ${data.expected.browser.page_views} ${data.expected.browser.unique_visitors} ${data.expected.browser.sessions}`,
  ]);
  await page.locator(".freshness-current").first().waitFor();
  await page.locator('select[name="dimension"]').selectOption("language");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/dimension=language/);
  await expectReportRows(page, "Dimension Report", ["en-CA 3 1 2", "en-US 2 1 1"]);
}

async function assertPhase6Disabled(page) {
  const data = await fixture("single-page-view");
  await resetDatabase();
  await setPhase6Enabled("site_playground", false);
  await postFixtureEvents(data.input);
  runProcessorOnce();
  await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
  await expectMetric(
    page,
    "Selected range Page Views",
    data.expected.api.range_overview.body.page_views,
  );
  assert(
    (await page.getByText("No Phase 6 analytics data is available for this selection.").count()) ===
      2,
    "Expected no visitor and dimension data while Phase 6 capabilities are disabled",
  );
}

async function assertPhase6Empty(page) {
  const data = await phase6Fixture("dashboard-dimensions");
  await preparePhase6Fixture(data);
  await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01"));
  assert(
    (await page.getByText("No Phase 6 analytics data is available for this selection.").count()) ===
      2,
    "Expected empty state for Visitors and Dimensions",
  );
}

async function assertDashboardConfiguration(page) {
  await page.goto(`${dashboardUrl}/dashboard/settings?site_id=site_playground`);
  await page.getByRole("heading", { name: "Site capabilities" }).waitFor();
  const anonymousVisitorsToggle = page.getByRole("checkbox", {
    name: "Enable Anonymous Visitors",
  });
  await anonymousVisitorsToggle.click();
  assert(
    await anonymousVisitorsToggle.isChecked(),
    "A capability with enabled dependents should remain enabled",
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Disable dependent capabilities first" })
    .waitFor();

  const geoToggle = page.getByRole("checkbox", { name: "Enable Geo country" });
  if (await geoToggle.isChecked()) await geoToggle.uncheck();
  const capabilitySave = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/sites/site_playground/capabilities") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save capabilities" }).click();
  const capabilityResponse = await capabilitySave;
  assert(
    capabilityResponse.ok(),
    `Capability save failed (${capabilityResponse.status()}): ${await capabilityResponse.text()}`,
  );
  await page.getByRole("status").filter({ hasText: "Capabilities saved." }).waitFor();
  await page.reload();
  assert(
    !(await page.getByRole("checkbox", { name: "Enable Geo country" }).isChecked()),
    "Capability change did not persist after reload",
  );

  const origins = page.locator("textarea");
  await origins.fill("not-an-origin");
  await page.getByRole("button", { name: "Create environment policy" }).click();
  await page.getByRole("alert").filter({ hasText: "allowed_origins" }).waitFor();
  await origins.fill("https://config-e2e.example.test");
  await page.getByRole("button", { name: "Create environment policy" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Website access settings saved. Ingestion is enabled." })
    .waitFor();
  await page.reload();
  assert(
    (await origins.inputValue()).includes("https://config-e2e.example.test"),
    "Origin change did not persist after reload",
  );
  const ingestionToggle = page.getByRole("checkbox", { name: "Enable environment ingestion" });
  assert(await ingestionToggle.isChecked(), "New environment policy should start enabled");
  await ingestionToggle.uncheck();
  const disableResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/ingest-policy") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save access settings" }).click();
  const disabledPolicyResponse = await disableResponse;
  assert(disabledPolicyResponse.ok(), "Disabling environment ingestion failed");
  const disabledPolicy = await disabledPolicyResponse.json();
  assert(disabledPolicy.policy.enabled === false, "Disabled environment policy was not stored");
  await page
    .getByRole("status")
    .filter({ hasText: "Website access settings saved. Ingestion is disabled." })
    .waitFor();
  await page.reload();
  assert(
    !(await page.getByRole("checkbox", { name: "Enable environment ingestion" }).isChecked()),
    "Environment ingestion state did not persist after reload",
  );
  const websiteAccess = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "Website access" }) });
  assert(
    (await websiteAccess.getByText(/Runtime status: (current|pending|stale)/).count()) === 1,
    "Environment runtime application status is missing",
  );
  assert(
    (await websiteAccess
      .getByText(`Stored version ${disabledPolicy.policy.version}`, { exact: true })
      .count()) === 1,
    "Environment policy stored version is missing or incorrect after disable",
  );

  const policyPath = `${analyticsUrl}/v1/admin/sites/site_playground/environments/config-e2e/ingest-policy`;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const currentPolicyResponse = await fetch(policyPath, { headers: adminHeaders });
  assert(currentPolicyResponse.ok, "Could not read policy for the version-conflict scenario");
  const currentPolicy = await currentPolicyResponse.json();
  const editedRateLimit = Number(await page.locator('input[type="number"]').inputValue()) + 10;
  await page.locator('input[type="number"]').fill(String(editedRateLimit + 10));
  const competingUpdate = await fetch(policyPath, {
    method: "PUT",
    headers: {
      ...adminHeaders,
      "Content-Type": "application/json",
      "If-Match": `"${currentPolicy.policy.version}"`,
    },
    body: JSON.stringify({
      enabled: currentPolicy.policy.enabled,
      allowed_origins: currentPolicy.policy.allowed_origins,
      rate_limit_per_minute: editedRateLimit,
    }),
  });
  assert(competingUpdate.ok, "Could not create the competing policy version");
  await page.getByRole("button", { name: "Save access settings" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Reload to review the latest configuration" })
    .waitFor();
  const reloadComplete = page.waitForNavigation();
  await page.getByRole("button", { name: "Reload latest configuration" }).click();
  await reloadComplete;
  assert(
    Number(await page.locator('input[type="number"]').inputValue()) === editedRateLimit,
    "Reload did not show the latest configuration after a version conflict",
  );

  await page.getByRole("checkbox", { name: "Enable environment ingestion" }).check();
  const enableResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/ingest-policy") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save access settings" }).click();
  const enabledPolicyResponse = await enableResponse;
  assert(enabledPolicyResponse.ok(), "Re-enabling environment ingestion failed");
  await enabledPolicyResponse.json();
  await page
    .getByRole("status")
    .filter({ hasText: "Website access settings saved. Ingestion is enabled." })
    .waitFor();

  await page.getByRole("button", { name: "Create Ingest Key" }).click();
  const displayedKey = page.locator(".one-time-secret code");
  await displayedKey.waitFor();
  const plaintext = await displayedKey.textContent();
  assert(
    plaintext && /^[A-Za-z0-9_-]{43}$/.test(plaintext),
    "Created Ingest Key was not displayed once in the expected format",
  );
  const firstKeyRow = page.locator(".key-list li").first();
  const firstKeyId = await firstKeyRow.locator("code").textContent();
  assert(firstKeyId, "Created key metadata is missing");
  await browserContext.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: dashboardUrl,
  });
  await page.getByRole("button", { name: "Copy key" }).click();
  assert(
    (await page.evaluate(() => navigator.clipboard.readText())) === plaintext,
    "Copy key did not place the one-time secret on the clipboard",
  );
  await page.getByRole("button", { name: "Hide key" }).click();
  assert(
    (await page.locator(".one-time-secret").count()) === 0,
    "Hide key should remove the plaintext from the page",
  );
  await page.getByRole("button", { name: "Create Ingest Key" }).click();
  await page.locator(".one-time-secret code").waitFor();
  await expect(page.locator(".key-list li")).toHaveCount(2);
  await page.reload();
  assert(
    !(await page.locator("body").innerText()).includes(plaintext),
    "Ingest Key plaintext was displayed again after reload",
  );
  await page
    .locator(".key-list li")
    .filter({ has: page.locator("code", { hasText: firstKeyId }) })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.locator(".key-list li")).toHaveCount(1);
  await page.locator(".key-list li").getByRole("button", { name: "Revoke" }).click();
  await page.getByText("No active ingest keys.").waitFor();
}

async function assertDefinitionManagement(page) {
  const originalFacts = Number(
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
        "-c",
        `SELECT COUNT(*) FROM conversion_facts WHERE site_id='site_playground' AND definition_version='${importedDefinitionVersion}'`,
      ],
      { capture: true },
    ).trim(),
  );
  const originalFunnelFacts = Number(
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
        "-c",
        `SELECT COUNT(*) FROM funnel_step_facts WHERE site_id='site_playground' AND definition_version='${importedDefinitionVersion}'`,
      ],
      { capture: true },
    ).trim(),
  );
  assert(originalFacts > 0, "Expected historical conversion facts before definition editing");
  assert(originalFunnelFacts > 0, "Expected historical funnel facts before definition editing");

  await page.goto(`${dashboardUrl}/dashboard/settings?site_id=site_playground`);
  const editor = page.locator('section[aria-label="Conversion and funnel definitions"]');
  const conversion = editor.locator("fieldset.card").nth(0);
  const funnel = editor.locator("fieldset.card").nth(1);
  await conversion.getByLabel("Name", { exact: true }).fill("Purchase completed managed");
  await funnel.getByLabel("Name", { exact: true }).fill("Checkout managed");

  const eventName = conversion.getByLabel("Event name", { exact: true });
  const validEventName = await eventName.inputValue();
  await eventName.fill("invalid event name");
  const validationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/sites/site_playground/conversion-funnel-definitions") &&
      response.request().method() === "PUT",
  );
  await editor.getByRole("button", { name: "Save new revision" }).click();
  assert(
    (await (await validationResponse).status()) === 422,
    "Invalid definitions must be rejected",
  );
  await editor.getByRole("alert").waitFor();
  await eventName.fill(validEventName);

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (
        String(args[0]).includes("/api/admin/sites/site_playground/conversion-funnel-definitions")
      )
        await new Promise((resolve) => setTimeout(resolve, 250));
      return originalFetch(...args);
    };
  });
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/sites/site_playground/conversion-funnel-definitions") &&
      response.request().method() === "PUT",
  );
  await editor.getByRole("button", { name: "Save new revision" }).click();
  assert(
    await conversion.getByLabel("Name", { exact: true }).isDisabled(),
    "Editor remained editable while saving",
  );
  const savedResponse = await saveResponse;
  assert(savedResponse.ok(), `Definition revision save failed (${savedResponse.status()})`);
  const saved = await savedResponse.json();
  assert(saved.revision === 2, "Definition edit did not append revision 2");
  assert(
    saved.definition_version !== importedDefinitionVersion,
    "New revision reused the import version label",
  );
  await editor
    .getByRole("status")
    .filter({ hasText: `Saved revision ${saved.definition_version}` })
    .waitFor();
  await page.reload();
  assert(
    (await editor.innerText()).includes("Purchase completed managed"),
    "Conversion edit did not persist after reload",
  );
  assert(
    (await editor.innerText()).includes("Checkout managed"),
    "Funnel edit did not persist after reload",
  );

  // Simulate another administrator saving after this editor loaded revision 2.
  const definitionsPath = `${analyticsUrl}/v1/admin/sites/site_playground/conversion-funnel-definitions`;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const latestResponse = await fetch(definitionsPath, { headers: adminHeaders });
  assert(latestResponse.ok, "Could not read definitions for the conflict scenario");
  const latest = await latestResponse.json();
  const competingUpdate = await fetch(definitionsPath, {
    method: "PUT",
    headers: {
      ...adminHeaders,
      "Content-Type": "application/json",
      "If-Match": `"${latest.revision}"`,
    },
    body: JSON.stringify({
      conversions: latest.conversions,
      funnels: latest.funnels.map((item) => ({ ...item, name: "Checkout concurrent" })),
    }),
  });
  assert(competingUpdate.ok, "Competing definition update failed");
  const concurrent = await competingUpdate.json();

  const conflictEditor = page.locator('section[aria-label="Conversion and funnel definitions"]');
  const conflictConversion = conflictEditor.locator("fieldset.card").nth(0);
  await conflictConversion.getByLabel("Name", { exact: true }).fill("Unsaved local draft");
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/sites/site_playground/conversion-funnel-definitions") &&
      response.request().method() === "PUT",
  );
  await conflictEditor.getByRole("button", { name: "Save new revision" }).click();
  assert((await (await conflictResponse).status()) === 409, "Stale revision must return HTTP 409");
  await conflictEditor
    .getByRole("alert")
    .getByRole("button", { name: "Reload latest definitions" })
    .waitFor();
  await page.evaluate(() => {
    window.confirm = (message) => {
      document.body.dataset.definitionReloadConfirmation = message;
      return false;
    };
  });
  await conflictEditor.getByRole("button", { name: "Reload latest definitions" }).click();
  assert(
    (await conflictConversion.getByLabel("Name", { exact: true }).inputValue()) ===
      "Unsaved local draft",
    "Declining conflict reload should preserve the local draft",
  );
  assert(
    (await page.locator("body").getAttribute("data-definition-reload-confirmation"))?.includes(
      "discard your unsaved changes",
    ),
    "Conflict reload did not explain that the local draft will be discarded",
  );
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  let latestReload;
  const captureLatestReload = (response) => {
    if (
      response.url().includes("/api/admin/sites/site_playground/conversion-funnel-definitions") &&
      response.request().method() === "GET"
    )
      latestReload = response;
  };
  page.on("response", captureLatestReload);
  await conflictEditor.getByRole("button", { name: "Reload latest definitions" }).click();
  await conflictEditor
    .getByRole("status")
    .filter({ hasText: "Loaded latest definitions" })
    .waitFor();
  page.off("response", captureLatestReload);
  assert(latestReload?.ok(), "Conflict reload did not read the latest definitions");
  await page.getByText("Checkout concurrent", { exact: true }).waitFor();
  const reloadedEditor = page.locator('section[aria-label="Conversion and funnel definitions"]');
  assert(
    (await reloadedEditor.innerText()).includes("Checkout concurrent"),
    "Conflict reload did not display the latest server definition",
  );
  assert(
    !(await reloadedEditor.innerText()).includes("Unsaved local draft"),
    "Conflict reload retained a draft the user confirmed discarding",
  );

  const reloadedConversion = reloadedEditor.locator("fieldset.card").nth(0);
  const reloadedFunnel = reloadedEditor.locator("fieldset.card").nth(1);
  await reloadedConversion.getByRole("checkbox").uncheck();
  await reloadedFunnel.getByRole("checkbox").uncheck();
  const deactivationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/sites/site_playground/conversion-funnel-definitions") &&
      response.request().method() === "PUT",
  );
  await reloadedEditor.getByRole("button", { name: "Save new revision" }).click();
  const deactivated = await (await deactivationResponse).json();
  assert(
    deactivated.revision === concurrent.revision + 1,
    "Deactivation did not append a revision",
  );
  assert(
    deactivated.conversions[0].active === false && deactivated.funnels[0].active === false,
    "Deactivation did not preserve definitions with inactive status",
  );
  await page.reload();
  const persistedEditor = page.locator('section[aria-label="Conversion and funnel definitions"]');
  assert(
    !(await persistedEditor.locator("fieldset.card").nth(0).getByRole("checkbox").isChecked()),
    "Conversion deactivation did not persist after reload",
  );
  assert(
    !(await persistedEditor.locator("fieldset.card").nth(1).getByRole("checkbox").isChecked()),
    "Funnel deactivation did not persist after reload",
  );

  await persistedEditor.getByRole("button", { name: "Add conversion" }).click();
  const newConversion = persistedEditor.locator("fieldset.card").nth(1);
  await newConversion.getByLabel("ID", { exact: true }).fill("managed_signup");
  await newConversion.getByLabel("Name", { exact: true }).fill("Managed signup");
  await newConversion.getByLabel("Event name", { exact: true }).fill("newsletter_signup");

  await persistedEditor.getByRole("button", { name: "Add funnel" }).click();
  const newFunnel = persistedEditor.locator("fieldset.card").nth(3);
  await newFunnel.getByLabel("ID", { exact: true }).fill("managed_onboarding");
  await newFunnel.getByLabel("Name", { exact: true }).fill("Managed onboarding");
  await newFunnel.getByLabel("Event name", { exact: true }).nth(0).fill("signup");
  await newFunnel.getByLabel("Event name", { exact: true }).nth(1).fill("onboarding_complete");

  const creationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/sites/site_playground/conversion-funnel-definitions") &&
      response.request().method() === "PUT",
  );
  await persistedEditor.getByRole("button", { name: "Save new revision" }).click();
  const created = await creationResponse;
  assert(created.ok(), `Creating definitions failed (${created.status()})`);
  const createdDefinitions = await created.json();
  assert(
    createdDefinitions.revision === deactivated.revision + 1 &&
      createdDefinitions.conversions.some((item) => item.id === "managed_signup") &&
      createdDefinitions.funnels.some((item) => item.id === "managed_onboarding"),
    "Creating Conversion and Funnel definitions did not append and save both definitions",
  );
  await page.reload();
  const createdEditor = page.locator('section[aria-label="Conversion and funnel definitions"]');
  assert(
    (await createdEditor
      .locator("fieldset.card")
      .nth(1)
      .getByLabel("ID", { exact: true })
      .inputValue()) === "managed_signup",
    "Created Conversion did not persist after reload",
  );
  assert(
    (await createdEditor
      .locator("fieldset.card")
      .nth(3)
      .getByLabel("ID", { exact: true })
      .inputValue()) === "managed_onboarding",
    "Created Funnel did not persist after reload",
  );

  const conversionFactCounts = runCompose(
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
      "-c",
      `SELECT definition_version || ':' || COUNT(*) FROM conversion_facts WHERE site_id='site_playground' GROUP BY definition_version ORDER BY definition_version`,
    ],
    { capture: true },
  )
    .trim()
    .split("\n");
  const funnelFactCounts = runCompose(
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
      "-c",
      `SELECT definition_version || ':' || COUNT(*) FROM funnel_step_facts WHERE site_id='site_playground' GROUP BY definition_version ORDER BY definition_version`,
    ],
    { capture: true },
  )
    .trim()
    .split("\n");
  assert(
    conversionFactCounts.length === 1 &&
      conversionFactCounts[0] === `${importedDefinitionVersion}:${originalFacts}`,
    "Definition edits or deactivation changed conversion history or triggered automatic backfill",
  );
  assert(
    funnelFactCounts.length === 1 &&
      funnelFactCounts[0] === `${importedDefinitionVersion}:${originalFunnelFacts}`,
    "Definition edits or deactivation changed funnel history or triggered automatic backfill",
  );

  const reportPath = `${analyticsUrl}/v1/sites/site_playground/reports/2026-09-20/2026-09-21/conversions`;
  const current = await (await fetch(reportPath)).json();
  const historical = await (
    await fetch(`${reportPath}?definition_version=${encodeURIComponent(importedDefinitionVersion)}`)
  ).json();
  const historicalFunnels = await (
    await fetch(
      `${analyticsUrl}/v1/sites/site_playground/reports/2026-09-20/2026-09-21/funnels?definition_version=${encodeURIComponent(importedDefinitionVersion)}`,
    )
  ).json();
  assert(
    current.definition_version === createdDefinitions.definition_version && current.total === 0,
    "Current report should use the latest revision without an automatic backfill",
  );
  assert(
    historical.definition_version === importedDefinitionVersion && historical.total > 0,
    "Historical report did not retain the imported revision's facts",
  );
  assert(
    historicalFunnels.definition_version === importedDefinitionVersion &&
      historicalFunnels.total > 0,
    "Historical funnel report did not retain the imported revision's facts",
  );
  await page.goto(
    `${dashboardUrl}/dashboard?site_id=site_playground&from=2026-09-20&to=2026-09-21&definition_version=${encodeURIComponent(importedDefinitionVersion)}`,
  );
  await page
    .getByText(`Definition revision: ${importedDefinitionVersion}`, { exact: true })
    .first()
    .waitFor();
}

async function assertApiError(browser) {
  let scenarioError;
  try {
    const errorNextVolume = `${project}_dashboard_error_next`;
    execFileSync("docker", ["volume", "create", errorNextVolume], {
      cwd: root,
      stdio: "ignore",
    });
    initializeNodeOwnedVolume(root, errorNextVolume);
    runCompose(
      [
        "run",
        "-d",
        "--no-deps",
        "--name",
        errorContainer,
        "-p",
        `${errorDashboardPort}:3000`,
        "-v",
        `${project}_dashboard_error_next:/workspace/apps/dashboard/.next`,
        "-e",
        "ANALYTICS_API_URL=http://dashboard-api-error:4999",
        "-e",
        "SITE_MANAGEMENT_API_URL=http://dashboard-api-error:4999",
        "-e",
        "DASHBOARD_CONFIG_ADMIN_TOKEN=e2e-admin-token",
        "-e",
        "DASHBOARD_DEFAULT_ENVIRONMENT=config-e2e",
        "dashboard",
      ],
      { capture: true },
    );
    const errorUrl = `http://127.0.0.1:${errorDashboardPort}`;
    await waitFor("Dashboard error instance", `${errorUrl}/dashboard`);
    const page = await browser.newPage();
    await page.goto(`${errorUrl}/dashboard?site_id=site_playground&from=2026-09-18&to=2026-09-18`);
    const directoryError = page.locator('[aria-label="Site directory status"]').getByRole("alert");
    await directoryError.waitFor();
    assert(
      (await directoryError.textContent()).includes("Analytics API simulated failure"),
      "Missing Site Registry API error state",
    );
    await page.close();
  } catch (error) {
    scenarioError = error;
  }

  const cleanupErrors = [];
  for (const [args, missingResource] of [
    [["rm", "-f", errorContainer], /no such container/i],
    [["volume", "rm", `${project}_dashboard_error_next`], /no such volume/i],
  ]) {
    try {
      execFileSync("docker", args, { cwd: root, stdio: "ignore" });
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message]
        .filter(Boolean)
        .map(String)
        .join("\n");
      if (!missingResource.test(output)) cleanupErrors.push(error);
    }
  }

  if (scenarioError) {
    for (const error of cleanupErrors)
      console.error(`Dashboard API-error cleanup failed: ${error}`);
    throw scenarioError;
  }
  if (cleanupErrors.length) throw cleanupErrors[0];
}

let browser;
let browserContext;
let page;
let browserTracingActive = false;
try {
  const artifactDirectory = path.join(root, "artifacts", "dashboard-e2e");
  await rm(artifactDirectory, { recursive: true, force: true });
  prepareE2ECaches(root, "dashboard");
  assertDashboardIsolation();
  await runCompose(["up", "-d", "--build", "--wait", "postgres"]);
  runCompose(["run", "--rm", "--build", "db-migrate"]);
  seedE2ECapabilityConfigurations(runCompose);
  seedE2EIngestPolicies(runCompose, keys);
  importDefinitionsIfEmpty();
  const composeOutput = runCompose(
    [
      "up",
      "-d",
      "--build",
      "--wait",
      "postgres",
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
        DASHBOARD_DEFAULT_ENVIRONMENT: "config-e2e",
      },
    },
  );
  process.stdout.write(composeOutput);
  await waitFor("Dashboard", `${dashboardUrl}/dashboard`);
  await waitFor("Next.js browser playground", "http://localhost:3000");
  await assertDashboardRuntimeConfiguration();
  browser = await chromium.launch({ headless: true });
  await assertBrowserWebVitalsCollection(browser);
  console.log("PASS real-browser Web Vitals collection and keepalive ingestion");
  browserContext = await browser.newContext();
  await browserContext.tracing.start({ screenshots: true, snapshots: true });
  browserTracingActive = true;
  page = await browserContext.newPage();

  await assertDashboardShell(page);
  console.log(
    "PASS responsive Dashboard shell, report anchors, filter context, and keyboard navigation",
  );
  await assertSinglePageView(page);
  console.log("PASS single-page-view dashboard");
  await assertGeoCountries(page);
  console.log("PASS geo-countries dashboard");
  await assertCustomEvents(page);
  console.log("PASS custom-events dashboard");
  await assertBackfilledConversionFunnels(page);
  console.log("PASS backfilled conversion and funnel dashboard");
  await assertDefinitionManagement(page);
  console.log(
    "PASS versioned Conversion/Funnel editing, history retention, and no automatic backfill",
  );
  await assertWebVitals(page);
  console.log("PASS web-vitals dashboard");
  await assertMultiPageNavigation(page);
  console.log("PASS multi-page-navigation dashboard");
  await assertMultiSiteIsolation(page);
  console.log("PASS multi-site-isolation dashboard");
  await assertEmptyRange(page);
  console.log("PASS empty-date-range dashboard");
  await assertCustomDateRange(page);
  console.log("PASS custom-date-range dashboard");
  await assertPhase6Disabled(page);
  console.log("PASS phase6-disabled dashboard");
  await assertPhase6Dashboard(page);
  console.log("PASS phase6 dashboard");
  await assertPhase6Empty(page);
  console.log("PASS phase6-empty dashboard");
  await browserContext.tracing.stop();
  browserTracingActive = false;
  await assertDashboardConfiguration(page);
  console.log(
    "PASS dashboard configuration, policy enablement, one-time key display, rotation, and revocation",
  );
  await assertApiError(browser);
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
    await writeFile(
      path.join(artifactDirectory, "compose-config.txt"),
      redactAdminToken(
        runCompose(["config"], {
          capture: true,
          allowFailure: true,
          env: {
            CONFIG_ADMIN_TOKENS: JSON.stringify([adminToken]),
            DASHBOARD_CONFIG_ADMIN_TOKEN: adminToken,
            DASHBOARD_DEFAULT_ENVIRONMENT: "config-e2e",
          },
        }),
      ),
    );
    await writeFile(
      path.join(artifactDirectory, "compose-ps.txt"),
      runCompose(["ps", "--all"], { capture: true, allowFailure: true }),
    );
    await writeFile(
      path.join(artifactDirectory, "service-logs.txt"),
      runCompose(
        [
          "logs",
          "--no-color",
          "dashboard",
          "playground-next",
          "collector",
          "analytics-api",
          "postgres",
          "db-migrate",
          "dashboard-api-error",
        ],
        {
          capture: true,
          allowFailure: true,
        },
      ),
    );
    console.error(`Dashboard E2E artifacts saved in ${artifactDirectory}`);
  } catch (artifactError) {
    console.error(`Dashboard Compose diagnostics could not be saved: ${artifactError}`);
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  if (browserContext) await browserContext.close();
  if (browser) await browser.close();
  runCompose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
}

function redactAdminToken(value) {
  return value.split(adminToken).join("[REDACTED]");
}
