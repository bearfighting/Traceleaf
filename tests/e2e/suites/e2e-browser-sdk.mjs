/* global console, fetch, process, window */

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  captureE2EComposeDiagnostics,
  createE2EComposeRunner,
  e2ePort,
  waitForHttpService,
} from "../support/e2e-compose.mjs";
import { seedE2EIngestPolicies } from "../support/e2e-ingest-policies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const project = process.env.E2E_SHARED_PROJECT ?? `web-analytics-browser-sdk-e2e-${process.pid}`;
const collectorUrl = `http://localhost:${e2ePort("E2E_COLLECTOR_PORT", 14001)}`;
const browserCollectorUrl = `http://127.0.0.1:${e2ePort("E2E_COLLECTOR_PORT", 14001)}`;
const analyticsUrl = `http://localhost:${e2ePort("E2E_ANALYTICS_API_PORT", 14002)}`;
const dashboardUrl = `http://localhost:${e2ePort("DASHBOARD_PORT", 13000)}`;
const playgroundUrl = `http://localhost:${e2ePort("PLAYGROUND_NEXT_PORT", 13001)}`;
const siteId = "site_playground";
const ingestKey = process.env.E2E_INGEST_KEY_PLAYGROUND ?? "e2e-test-key";
const managed = Boolean(process.env.E2E_SHARED_PROJECT);
const { runCompose } = createE2EComposeRunner({
  root,
  project,
  profiles: ["backend", "storage", "processing", "dashboard", "playground-next"],
});

let browser;
let context;
let page;
let cdpSession;
let processorOutput = "";

try {
  await mkdir(path.join(root, "artifacts", "browser-sdk-e2e"), { recursive: true });
  seedE2EIngestPolicies(runCompose, { [siteId]: ingestKey }, [playgroundUrl]);
  runCompose(
    [
      "up",
      "-d",
      ...(!managed ? ["--build"] : []),
      "--wait",
      ...(managed ? ["--no-deps"] : []),
      "collector",
      "analytics-api",
      "dashboard",
      "playground-next",
    ],
    {
      env: {
        NEXT_PUBLIC_ANALYTICS_TRANSPORT: "fetch",
        NEXT_PUBLIC_ANALYTICS_ENDPOINT: `${browserCollectorUrl}/v1/events`,
        NEXT_PUBLIC_ANALYTICS_INGEST_KEY: ingestKey,
        NEXT_PUBLIC_ANALYTICS_SITE_ID: siteId,
        DASHBOARD_DEFAULT_ENVIRONMENT: "e2e",
      },
    },
  );
  await waitForHttpService("Collector", `${collectorUrl}/health`);
  await waitForHttpService("Analytics API", `${analyticsUrl}/health`);
  await waitForHttpService("Dashboard", `${dashboardUrl}/dashboard`);
  await waitForHttpService("Next.js playground", playgroundUrl);

  browser = await chromium.launch({ headless: true, args: ["--enable-web-security"] });
  context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true });
  page = await context.newPage();
  const pageErrors = [];
  const browserRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  cdpSession = await context.newCDPSession(page);
  await cdpSession.send("Network.enable");
  cdpSession.on("Network.requestWillBeSent", (event) => {
    if (new URL(event.request.url).pathname === "/v1/events") {
      browserRequests.push({ requestId: event.requestId, request: event.request });
    }
  });
  cdpSession.on("Network.responseReceived", (event) => {
    const request = browserRequests.find(({ requestId }) => requestId === event.requestId);
    if (request) request.response = event.response;
  });

  console.log("[data-pipeline] Chromium / real @traceleaf/browser entry / isolated E2E Compose");
  const initialDocument = await page.goto(playgroundUrl, { waitUntil: "domcontentloaded" });
  assert(
    initialDocument?.status() === 200 &&
      (await initialDocument.text()).includes("Navigation Debug Panel"),
    "Next.js must server-render the playground document before hydration",
  );
  await page.getByTestId("events-json").waitFor();
  await page.waitForFunction(() => {
    const log = document.querySelector('[data-testid="events-json"]')?.textContent ?? "[]";
    return log.includes('"navigationType":"initial"');
  });
  await page.getByRole("link", { name: /About via Link/ }).click();
  await page.waitForFunction(() => location.pathname === "/about");
  await page.waitForFunction(() => {
    const log = document.querySelector('[data-testid="events-json"]')?.textContent ?? "[]";
    return log.includes('"path":"/about"');
  });

  const browserCollectorEndpoint = browserRequests.find(({ request }) => request.method === "POST")
    ?.request.url;
  const collectorPreflight = browserRequests.find(
    ({ request }) =>
      request.method === "OPTIONS" &&
      request.url === browserCollectorEndpoint &&
      headerValue(request.headers, "access-control-request-method")?.toUpperCase() === "POST",
  );
  assert(collectorPreflight, "Browser did not send a Collector CORS preflight for POST");
  const preflightResponse = collectorPreflight.response;
  assert(preflightResponse, "Collector CORS preflight did not receive a response");
  const preflightHeaders = Object.fromEntries(
    Object.entries(preflightResponse.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const allowedHeaderNames = (preflightHeaders["access-control-allow-headers"] ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase());
  const allowedMethods = (preflightHeaders["access-control-allow-methods"] ?? "")
    .split(",")
    .map((method) => method.trim().toUpperCase());
  assert(
    preflightResponse.status === 204,
    `Collector CORS preflight returned ${preflightResponse.status}, expected 204`,
  );
  assert(
    preflightHeaders["access-control-allow-origin"] === new URL(page.url()).origin,
    `Collector allowed Origin ${preflightHeaders["access-control-allow-origin"]}, expected ${new URL(page.url()).origin}`,
  );
  assert(allowedMethods.includes("POST"), "Collector CORS preflight did not allow POST");
  assert(
    ["content-type", "x-ingest-key"].every((header) => allowedHeaderNames.includes(header)),
    `Collector CORS preflight did not allow Content-Type and X-Ingest-Key: ${allowedHeaderNames.join(", ")}`,
  );
  console.log(
    "PASS Chromium Collector CORS preflight: 204, matching Origin, POST, Content-Type, X-Ingest-Key",
  );

  const pageViews = queryJson(
    `SELECT path, COUNT(*)::int AS count FROM raw_events WHERE site_id='${siteId}' AND event_type='page_view' GROUP BY path ORDER BY path`,
  );
  assert(
    pageViews.some(({ path }) => path === "/"),
    "SDK initial Page View was not persisted",
  );
  assert(
    pageViews.some(({ path }) => path === "/about"),
    "SDK client navigation was not persisted",
  );
  assert(
    pageViews.reduce((total, row) => total + row.count, 0) >= 2,
    "Expected two browser Page Views",
  );
  processorOutput = runCompose(
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
      "once",
      "process",
    ],
    { capture: true },
  );
  const reportDate = new Date().toISOString().slice(0, 10);
  const reportResponse = await fetch(
    `${analyticsUrl}/v1/sites/${siteId}/reports/${reportDate}/${reportDate}/pages`,
  );
  const report = await reportResponse.json();
  assert(
    reportResponse.status === 200,
    `Analytics API rejected browser events: ${JSON.stringify(report)}`,
  );
  assert(
    report.items.some((item) => item.path === "/"),
    "Analytics API omitted initial browser Page View",
  );
  assert(
    report.items.some((item) => item.path === "/about"),
    "Analytics API omitted navigation Page View",
  );
  await page.goto(
    `${dashboardUrl}/dashboard/pages?site_id=${siteId}&from=${reportDate}&to=${reportDate}`,
  );
  await page.getByRole("heading", { name: "Pages", exact: true }).waitFor();
  const dashboardRows = await page
    .locator("#top-pages tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "").join(" "),
      ),
    );
  for (const item of report.items) {
    assert(
      dashboardRows.includes(`${item.path} ${item.page_views}`),
      `Dashboard Top Pages omitted ${item.path} ${item.page_views}`,
    );
  }
  console.log("PASS browser SDK → Collector → PostgreSQL → Processor → Analytics API → Dashboard");

  const empty = await fetch(
    `${analyticsUrl}/v1/sites/${siteId}/reports/2001-01-01/2001-01-02/pages`,
  );
  const emptyBody = await empty.json();
  assert(
    empty.status === 200 && emptyBody.items.length === 0,
    "Empty date range must return a successful empty report",
  );
  await page.goto(
    `${dashboardUrl}/dashboard/pages?site_id=${siteId}&from=2001-01-01&to=2001-01-02`,
  );
  await page.getByRole("heading", { name: "Top Pages", exact: true }).waitFor();
  await page
    .locator("#top-pages")
    .getByText("No page view data is available for this selection.", { exact: true })
    .waitFor();
  console.log(
    "[fail-open / SSR] server-rendered Next.js page, hydration, empty data, transport failure",
  );
  assert(
    pageErrors.length === 0,
    `SSR/hydration raised browser exceptions: ${pageErrors.join("; ")}`,
  );

  let serviceErrorAttempts = 0;
  await page.route(`${browserCollectorUrl}/v1/events`, (route) => {
    serviceErrorAttempts += 1;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"simulated"}',
    });
  });
  await page.goto(`${playgroundUrl}?sdk-e2e=throw-on-error`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("events-json").waitFor();
  await page.waitForFunction(() => sessionStorage.getItem("__sdk_e2e_on_error_called") === "true");
  assert(serviceErrorAttempts > 0, "SDK did not attempt the simulated HTTP 503 request");
  await page.getByRole("link", { name: /About via Link/ }).click();
  await page.waitForFunction(() => location.pathname === "/about");
  assert(
    pageErrors.length === 0,
    `Transport failure interrupted the app: ${pageErrors.join("; ")}`,
  );
  await page.unrouteAll();
  await page.evaluate(() => sessionStorage.removeItem("__sdk_e2e_on_error_called"));
  let unavailableAttempts = 0;
  await page.route(`${browserCollectorUrl}/v1/events`, (route) => {
    unavailableAttempts += 1;
    return route.abort("failed");
  });
  await page.goto(`${playgroundUrl}?sdk-e2e=throw-on-error`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("events-json").waitFor();
  await page.waitForFunction(() => sessionStorage.getItem("__sdk_e2e_on_error_called") === "true");
  assert(
    unavailableAttempts > 0,
    "SDK did not attempt the simulated unavailable Collector request",
  );
  await page.getByRole("link", { name: /About via Link/ }).click();
  await page.waitForFunction(() => location.pathname === "/about");
  assert(
    pageErrors.length === 0,
    `SDK error recovery interrupted the app: ${pageErrors.join("; ")}`,
  );

  await page.unrouteAll();
  await page.evaluate(() => sessionStorage.removeItem("__sdk_e2e_on_error_called"));
  await page.goto(`${playgroundUrl}?sdk-e2e=invalid-config`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("events-json").waitFor();
  await page.waitForFunction(() => sessionStorage.getItem("__sdk_e2e_on_error_called") === "true");
  await page.getByRole("link", { name: /About via Link/ }).click();
  await page.waitForFunction(() => location.pathname === "/about");
  assert(
    pageErrors.length === 0,
    `Invalid SDK configuration interrupted the app: ${pageErrors.join("; ")}`,
  );
  console.log("PASS invalid configuration and transport errors with a throwing error callback");

  await page.goto(`${playgroundUrl}?sdk-e2e=throw-on-error`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("events-json").waitFor();
  await page.evaluate(() => sessionStorage.removeItem("__sdk_e2e_on_error_called"));
  let rejectedOriginStatus;
  await page.route(`${browserCollectorUrl}/v1/events`, async (route) => {
    const response = await fetch(route.request().url(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ingest-key": ingestKey,
        origin: "http://denied.example",
      },
      body: route.request().postData() ?? "",
    });
    rejectedOriginStatus = response.status;
    const responseBody = await response.text();
    await route.fulfill({
      status: rejectedOriginStatus,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: responseBody,
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => sessionStorage.getItem("__sdk_e2e_on_error_called") === "true");
  assert(
    rejectedOriginStatus === 403,
    `Collector rejected Origin with ${rejectedOriginStatus}, expected 403`,
  );
  await page.getByRole("link", { name: /About via Link/ }).click();
  await page.waitForFunction(() => location.pathname === "/about");
  assert(pageErrors.length === 0, "Rejected Origin interrupted host navigation");
  console.log("PASS rejected Origin returns 403 and remains fail-open in the host page");

  await context.tracing.stop({
    path: path.join(root, "artifacts", "browser-sdk-e2e", "trace.zip"),
  });
  console.log("Browser SDK E2E acceptance passed.");
} catch (error) {
  const artifactDirectory = path.join(root, "artifacts", "browser-sdk-e2e");
  await mkdir(artifactDirectory, { recursive: true });
  if (page) {
    try {
      await page.screenshot({ path: path.join(artifactDirectory, "failure.png"), fullPage: true });
    } catch {}
  }
  if (context) {
    try {
      await context.tracing.stop({ path: path.join(artifactDirectory, "trace.zip") });
    } catch {}
  }
  try {
    await captureE2EComposeDiagnostics({
      runCompose,
      artifactDirectory,
      services: [
        "collector",
        "processor",
        "analytics-api",
        "dashboard",
        "playground-next",
        "postgres",
      ],
    });
    await writeFile(path.join(artifactDirectory, "processor-output.txt"), processorOutput);
  } catch (diagnosticError) {
    console.error(`Could not save Compose diagnostics: ${diagnosticError}`);
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  console.error(`Browser SDK E2E diagnostics saved in ${artifactDirectory}`);
  process.exitCode = 1;
} finally {
  if (cdpSession) await cdpSession.detach();
  if (context) await context.close();
  if (browser) await browser.close();
}

function queryJson(sql) {
  const result = runCompose(
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
      `SELECT COALESCE(json_agg(row_to_json(result)), '[]'::json) FROM (${sql}) AS result`,
    ],
    { capture: true },
  );
  return JSON.parse(result.trim() || "[]");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function headerValue(headers, expectedName) {
  const normalizedName = expectedName.toLowerCase();
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === normalizedName);
  return entry?.[1];
}
