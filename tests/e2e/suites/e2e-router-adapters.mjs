import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { chromium, expect } from "@playwright/test";

const root = new URL("../../..", import.meta.url).pathname;
const servers = [];

try {
  const [nextPort, reactPort, tanstackPort] = await Promise.all([
    reservePort(),
    reservePort(),
    reservePort(),
  ]);
  start("@web-analytics/nextjs-router-playground", nextPort, "next");
  start("@web-analytics/react-router-playground", reactPort, "vite");
  start("@web-analytics/tanstack-router-playground", tanstackPort, "vite");
  await Promise.all([
    waitForServer(nextPort),
    waitForServer(reactPort),
    waitForServer(tanstackPort),
  ]);

  const browser = await chromium.launch({ headless: true });
  try {
    await checkNext(browser, `http://127.0.0.1:${nextPort}`);
    await checkRouter(browser, `http://127.0.0.1:${reactPort}`, "React Router User");
    await checkRouter(browser, `http://127.0.0.1:${tanstackPort}`, "TanStack Router User");
  } finally {
    await browser.close();
  }
  console.log("Router adapter E2E passed for Next, React Router and TanStack Router.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  for (const server of servers) {
    if (process.platform === "win32") {
      server.kill("SIGTERM");
      continue;
    }

    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

async function checkNext(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const events = page.getByTestId("events-json");
  await expect(events).toContainText('"navigationType":"initial"');

  await page.getByRole("link", { name: "About via Link" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(events).toContainText('"navigationType":"push"');

  await page.getByRole("button", { name: "router.replace()" }).click();
  await expect(page).toHaveURL(/\/about\?source=replace$/);
  await expect(events).toContainText('"navigationType":"replace"');

  const beforeHash = JSON.parse((await events.textContent()) ?? "[]").length;
  await page.getByRole("link", { name: "Update hash" }).click();
  await page.waitForTimeout(100);
  const afterHash = JSON.parse((await events.textContent()) ?? "[]").length;
  if (afterHash !== beforeHash) {
    throw new Error(`Hash-only navigation emitted an event for ${baseUrl}`);
  }

  await expect(page.getByTestId("analytics-events")).not.toHaveText("0");
  await page.close();
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function start(filter, port, kind) {
  const hostFlag = kind === "next" ? "--hostname" : "--host";
  const child = spawn(
    "pnpm",
    ["--filter", filter, "dev", hostFlag, "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: "ignore",
    },
  );
  servers.push(child);
  return child;
}

async function waitForServer(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Router playground on port ${port} did not start`);
}

async function checkRouter(browser, baseUrl, expectedTitle) {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.getByRole("link", { name: "User" }).click();
  await page.getByRole("heading", { name: expectedTitle }).waitFor();
  const eventsLocator = page.getByTestId("events");
  await expect(eventsLocator).toContainText('"navigationType":"push"');
  const events = await eventsLocator.textContent();
  if (
    !events?.includes('"navigationType":"initial"') ||
    !events.includes('"navigationType":"push"') ||
    !events.includes("/users/42")
  ) {
    throw new Error(`Navigation event assertion failed for ${baseUrl}: ${events}`);
  }
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByRole("heading", { name: `${expectedTitle.split(" User")[0]} Search` }).waitFor();
  await page.getByRole("button", { name: "Replace" }).click();
  await page.getByRole("heading", { name: expectedTitle }).waitFor();
  await expect(eventsLocator).toContainText('"navigationType":"replace"');

  await page.goBack();
  await expect(eventsLocator).toContainText('"navigationType":"pop"');
  await expect(eventsLocator).toContainText("/users/42");

  const beforeHash = JSON.parse((await eventsLocator.textContent()) ?? "[]").length;
  await page.getByRole("link", { name: "Hash" }).click();
  await page.waitForTimeout(100);
  const afterHash = JSON.parse((await eventsLocator.textContent()) ?? "[]").length;
  if (afterHash !== beforeHash) {
    throw new Error(`Hash-only navigation emitted an event for ${baseUrl}`);
  }

  const analyticsEvents = page.getByTestId("analytics-events");
  await expect(analyticsEvents).toContainText('"type":"page_view"');
  await expect
    .poll(
      async () =>
        ((await analyticsEvents.textContent())?.match(/"type":"page_view"/g) ?? []).length,
    )
    .toBeGreaterThanOrEqual(5);
  await page.close();
}
