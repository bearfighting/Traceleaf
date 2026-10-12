import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { chromium, expect } from "@playwright/test";
import { createRequire } from "node:module";

const root = new URL("../../..", import.meta.url).pathname;
const servers = [];

try {
  const [
    nextPort,
    reactPort,
    tanstackPort,
    vanillaPort,
    vuePort,
    sveltePort,
    solidPort,
    angularPort,
    astroPort,
  ] = await Promise.all([
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
  ]);
  start("@web-analytics/nextjs-router-playground", nextPort, "next");
  start("@web-analytics/react-router-playground", reactPort, "vite");
  start("@web-analytics/tanstack-router-playground", tanstackPort, "vite");
  start("@web-analytics/vanilla-playground", vanillaPort, "vite");
  start("@web-analytics/vue-playground", vuePort, "vite");
  start("@web-analytics/svelte-playground", sveltePort, "vite");
  start("@web-analytics/solid-playground", solidPort, "vite");
  start("@web-analytics/angular-playground", angularPort, "angular");
  start("@web-analytics/astro-playground", astroPort, "astro");
  await Promise.all([
    waitForServer(nextPort),
    waitForServer(reactPort),
    waitForServer(tanstackPort),
    waitForServer(vanillaPort),
    waitForServer(vuePort),
    waitForServer(sveltePort),
    waitForServer(solidPort),
    waitForServer(angularPort),
    waitForServer(astroPort),
  ]);

  const browser = await chromium.launch({ headless: true });
  try {
    console.log(
      `Chromium ${browser.version()} with Playwright ${createRequire(import.meta.url)("@playwright/test/package.json").version}`,
    );
    const failures = [];
    for (const [name, check] of [
      ["Next.js", () => checkNext(browser, `http://127.0.0.1:${nextPort}`)],
      [
        "React Router",
        () => checkRouter(browser, `http://127.0.0.1:${reactPort}`, "React Router User"),
      ],
      [
        "TanStack Router",
        () => checkRouter(browser, `http://127.0.0.1:${tanstackPort}`, "TanStack Router User"),
      ],
      ["Vanilla JavaScript", () => checkVanilla(browser, `http://127.0.0.1:${vanillaPort}`)],
      ...[
        ["Vue", vuePort],
        ["SvelteKit", sveltePort],
        ["Solid", solidPort],
        ["Angular", angularPort],
      ].map(([name, port]) => [
        name,
        () => checkFramework(browser, `http://127.0.0.1:${port}`, name),
      ]),
      ["Astro", () => checkAstro(browser, `http://127.0.0.1:${astroPort}`)],
    ]) {
      try {
        const result = await check();
        console.log(`${name}: ${result ?? "Navigation API observer checks passed."}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${name}: ${message}`);
        console.error(`${name}: ${message}`);
      }
    }
    if (failures.length) throw new Error(failures.join("\n"));
  } finally {
    await browser.close();
  }
  console.log("Navigation API observer E2E passed for all nine playgrounds.");
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
  const pageViews = page.getByTestId("analytics-page-views");
  await expectSingleInitialPageView(page, events, pageViews);

  await page.getByRole("link", { name: "About via Link" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page).toHaveTitle("About");
  await expect(events).toContainText('"navigationType":"push"');
  await expectNavigationTitle(events, "/about", "About");

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
  await checkControlledNavigationScenarios(
    page,
    baseUrl,
    "[data-testid=events-json]",
    "[data-testid=analytics-page-views]",
  );
  await checkRapidCommittedNavigations(page, baseUrl, "[data-testid=events-json]", "newest-first");
  await page.close();
}

async function checkVanilla(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const events = page.getByTestId("events-json");
  const pageViews = page.getByTestId("analytics-page-views");
  await expectSingleInitialPageView(page, events, pageViews);
  await expect(page.getByTestId("second-instance-page-views")).toHaveText("0");
  await page.waitForTimeout(100);
  await expect(page.getByTestId("second-instance-page-views")).toHaveText("0");

  await page.getByRole("button", { name: "Push page" }).click();
  await expect(page).toHaveURL(/\/page$/);
  await expect(page).toHaveTitle("Page");
  await expect(events).toContainText('"navigationType":"push"');
  await expectNavigationTitle(events, "/page", "Page");
  await expect.poll(async () => countPageViews(await pageViews.textContent())).toBe(2);

  await page.getByRole("button", { name: "Replace page" }).click();
  await expect(page).toHaveURL(/\/replaced$/);
  await expect(events).toContainText('"navigationType":"replace"');
  const beforeHash = parseNavigationEvents(await events.textContent()).length;
  await page.getByRole("button", { name: "Change hash" }).click();
  await expect(page).toHaveURL(/#section$/);
  await page.waitForTimeout(100);
  if (parseNavigationEvents(await events.textContent()).length !== beforeHash) {
    throw new Error("Vanilla hash-only navigation emitted an observer event");
  }

  await page.getByRole("button", { name: "Change search" }).click();
  await expect(page).toHaveURL(/\/search\?query=/);
  await expect(events).toContainText('"navigationType":"push"');
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/replaced#section$/);
  await expect(events).toContainText('"navigationType":"pop"');
  await page.getByRole("button", { name: "Forward" }).click();
  await expect(page).toHaveURL(/\/search\?query=/);
  await assertNavigationEventSequence(await events.textContent(), [
    { path: "/", navigationType: "initial" },
    { path: "/page", navigationType: "push", title: "Page" },
    { path: "/replaced", navigationType: "replace", title: "Replaced" },
    { path: "/search", navigationType: "push", title: "Search" },
    { path: "/replaced", navigationType: "pop", title: "Replaced" },
    { path: "/search", navigationType: "pop", title: "Search" },
  ]);

  const secondaryViews = page.getByTestId("second-instance-page-views");
  await expect.poll(async () => Number(await secondaryViews.textContent())).toBeGreaterThan(0);
  const secondaryBeforeRemoval = Number(await secondaryViews.textContent());
  await page.getByTestId("remove-second-instance").click();
  await expect(page.getByTestId("active-instances")).toHaveText("1");
  await page.getByRole("button", { name: "Push page" }).click();
  await expect(page).toHaveURL(/\/page$/);
  await expect.poll(async () => countPageViews(await pageViews.textContent())).toBeGreaterThan(4);
  await expect(secondaryViews).toHaveText(String(secondaryBeforeRemoval));

  await checkControlledNavigationScenarios(
    page,
    baseUrl,
    '[data-testid="events-json"]',
    '[data-testid="analytics-page-views"]',
  );
  await checkRapidCommittedNavigations(
    page,
    baseUrl,
    '[data-testid="events-json"]',
    "oldest-first",
  );
  await page.close();
}

async function assertNavigationEventSequence(text, expectedEvents) {
  const events = parseNavigationEvents(text);
  if (events.length !== expectedEvents.length) {
    throw new Error(
      `Expected ${expectedEvents.length} Vanilla events, received ${JSON.stringify(events)}`,
    );
  }
  for (let index = 0; index < expectedEvents.length; index += 1) {
    const actual = events[index];
    const expected = expectedEvents[index];
    if (
      new URL(actual.url).pathname !== expected.path ||
      actual.navigationType !== expected.navigationType ||
      (expected.title && actual.title !== expected.title) ||
      (index > 0 && actual.occurredAt <= events[index - 1].occurredAt)
    ) {
      throw new Error(
        `Vanilla event ${index} did not match ${JSON.stringify(expected)}: ${JSON.stringify(actual)}`,
      );
    }
    if (
      events
        .slice(0, index)
        .some(
          (previous) =>
            previous.url === actual.url && previous.navigationType === actual.navigationType,
        )
    ) {
      throw new Error(`Vanilla navigation was reported more than once: ${JSON.stringify(actual)}`);
    }
  }
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
  const hostFlag = kind === "next" ? "--hostname" : kind === "angular" ? "--host" : "--host";
  const commandArgs = ["--filter", filter, "dev", hostFlag, "127.0.0.1", "--port", String(port)];
  const child = spawn("pnpm", commandArgs, {
    cwd: root,
    detached: process.platform !== "win32",
    env: { ...process.env, NEXT_PUBLIC_ANALYTICS_TRANSPORT: "mock" },
    stdio: "ignore",
  });
  servers.push(child);
  return child;
}

async function checkFramework(browser, baseUrl, name) {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const events = page.getByTestId("events");
  await expect(page).toHaveTitle(`${name} Home`);
  await expect(events).toContainText('"navigationType":"initial"');
  await expectNavigationTitle(events, "/", `${name} Home`, "initial");
  await page.getByRole("link", { name: "User" }).click();
  await expect(page).toHaveURL(/\/users\/42$/);
  await expect(page.getByRole("heading", { name: `${name} User` })).toBeVisible();
  await expect(page).toHaveTitle(`${name} User`);
  await expectNavigationEvent(events, "/users/42", "push");
  await expectNavigationTitle(events, "/users/42", `${name} User`);
  await page.close();
}

async function checkAstro(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const events = page.getByTestId("events");
  await expect(page).toHaveTitle("Astro Home");
  await expect(events).toContainText('"navigationType":"initial"');
  await expectNavigationTitle(events, "/", "Astro Home", "initial");
  await page.getByRole("link", { name: "User" }).click();
  await expect(page).toHaveURL(/\/users\/42$/);
  await expect(page.getByRole("heading", { name: "Astro User" })).toBeVisible();
  await expect(page).toHaveTitle("Astro User");
  await expectNavigationEvent(events, "/users/42", "push");
  await expectNavigationTitle(events, "/users/42", "Astro User");
  await page.close();
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
  await expectSingleInitialPageView(
    page,
    page.getByTestId("events"),
    page.getByTestId("analytics-events"),
  );
  await page.getByRole("link", { name: "User" }).click();
  await page.getByRole("heading", { name: expectedTitle }).waitFor();
  await expect(page).toHaveTitle(expectedTitle);
  const eventsLocator = page.getByTestId("events");
  await expect(eventsLocator).toContainText('"navigationType":"push"');
  await expectNavigationTitle(eventsLocator, "/users/42", expectedTitle);
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
  await checkControlledNavigationScenarios(
    page,
    baseUrl,
    '[data-testid="events"]',
    '[data-testid="analytics-events"]',
  );
  await checkRapidCommittedNavigations(page, baseUrl, '[data-testid="events"]', "oldest-first");
  await page.close();
}

async function checkRapidCommittedNavigations(page, baseUrl, eventsSelector, eventOrder) {
  await page.goto(baseUrl);
  const events = page.locator(eventsSelector);
  await expect(events).toContainText('"navigationType":"initial"');
  const previous = parseNavigationEvents(await events.textContent());
  const targets = await page.evaluate(async () => {
    const navigation = window.navigation;
    if (!navigation) throw new Error("Navigation API is unavailable");
    const diagnostics = [];
    const logNavigate = (event) =>
      diagnostics.push({
        event: "navigate",
        url: event.destination.url,
        type: event.navigationType,
        fromKey: navigation.currentEntry?.key,
      });
    const logEntryChange = (event) =>
      diagnostics.push({
        event: "currententrychange",
        type: event.navigationType,
        fromKey: event.from?.key,
        currentKey: navigation.currentEntry?.key,
        currentUrl: navigation.currentEntry?.url,
      });
    navigation.addEventListener("navigate", logNavigate);
    navigation.addEventListener("currententrychange", logEntryChange);
    const base = new URL(navigation.currentEntry.url);
    const first = new URL(base.href);
    first.searchParams.set("rapid-navigation", "first");
    const second = new URL(base.href);
    second.searchParams.set("rapid-navigation", "second");
    const targets = new Set([first.href, second.href]);
    const interceptTargets = (event) => {
      if (!targets.has(event.destination.url)) return;
      event.intercept({ handler: async () => {} });
    };
    navigation.addEventListener("navigate", interceptTargets);
    const start = Date.now();
    const firstResult = navigation.navigate(first.href);
    await firstResult.committed;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const secondResult = navigation.navigate(second.href);
    await secondResult.committed;
    document.title = "Rapid navigation final title";
    await Promise.allSettled([firstResult.finished, secondResult.finished]);
    navigation.removeEventListener("navigate", interceptTargets);
    navigation.removeEventListener("navigate", logNavigate);
    navigation.removeEventListener("currententrychange", logEntryChange);

    return {
      urls: [first.href, second.href],
      start,
      end: Date.now(),
      current: navigation.currentEntry.url,
      diagnostics,
    };
  });
  if (targets.current !== targets.urls[1]) {
    throw new Error(`Rapid navigation ended at ${targets.current}, expected ${targets.urls[1]}`);
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (parseNavigationEvents(await events.textContent()).length >= previous.length + 2) break;
    await page.waitForTimeout(50);
  }
  if (parseNavigationEvents(await events.textContent()).length !== previous.length + 2) {
    throw new Error(
      `Rapid navigation event count mismatch (expected two events, got ${JSON.stringify(parseNavigationEvents(await events.textContent()))}; browser trace ${JSON.stringify(targets.diagnostics)})`,
    );
  }
  const displayed = parseNavigationEvents(await events.textContent()).filter((event) =>
    targets.urls.includes(event.url),
  );
  const reported = eventOrder === "newest-first" ? displayed.reverse() : displayed;
  if (
    reported.map((event) => event.url).join("\n") !== targets.urls.join("\n") ||
    reported.some((event) => event.navigationType !== "push") ||
    reported.some(
      (event, index) => index > 0 && event.occurredAt <= reported[index - 1].occurredAt,
    ) ||
    reported.some(
      (event) => event.occurredAt < targets.start || event.occurredAt > targets.end + 1000,
    )
  ) {
    throw new Error(
      `Rapid navigation events were out of order or invalid (expected ${JSON.stringify(targets)}, got ${JSON.stringify(reported)}): ${JSON.stringify(reported)}`,
    );
  }
  for (const target of targets.urls) {
    if (reported.filter((event) => event.url === target).length !== 1) {
      throw new Error(`Rapid navigation ${target} was not reported exactly once`);
    }
  }
}

async function checkControlledNavigationScenarios(
  page,
  baseUrl,
  eventsSelector,
  pageViewsSelector,
) {
  const scenarios = [
    { name: "cancelled", mode: "cancel", expectedCount: 0 },
    { name: "failed-before-commit", mode: "fail-before-commit", expectedCount: 0 },
    { name: "failed-after-commit", mode: "commit-then-fail", expectedCount: 1 },
    { name: "successful", mode: "commit", expectedCount: 1 },
  ];

  for (const scenario of scenarios) {
    await page.goto(baseUrl);
    const events = page.locator(eventsSelector);
    await expect(events).toContainText('"navigationType":"initial"');
    await expectSingleInitialPageView(page, events, page.locator(pageViewsSelector));
    const before = parseNavigationEvents(await events.textContent());
    const target = new URL(`/?navigation-e2e=${scenario.name}`, baseUrl).href;
    const navigationTrace = [];
    await page.evaluate(() => {
      const navigation = window.navigation;
      window.__navigationTrace = [];
      navigation.addEventListener("navigate", (event) => {
        window.__navigationTrace.push({
          event: "navigate",
          url: event.destination.url,
          type: event.navigationType,
          fromKey: navigation.currentEntry?.key,
        });
      });
      navigation.addEventListener("currententrychange", (event) => {
        window.__navigationTrace.push({
          event: "currententrychange",
          type: event.navigationType,
          fromKey: event.from?.key,
          currentKey: navigation.currentEntry?.key,
        });
      });
    });

    await page.evaluate(
      async ({ targetUrl, mode }) => {
        if (!window.navigation) throw new Error("Navigation API is unavailable");
        if (mode === "fail-before-commit") {
          try {
            window.navigation.navigate(targetUrl, { history: "invalid" });
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;

            return;
          }
          throw new Error("Expected invalid Navigation API options to be rejected");
        }
        if (mode === "cancel") {
          const cancelNavigation = (event) => {
            if (event.destination.url !== targetUrl) return;
            window.navigation.removeEventListener("navigate", cancelNavigation);
            event.preventDefault();
          };
          window.navigation.addEventListener("navigate", cancelNavigation);
          try {
            await window.navigation.navigate(targetUrl).finished;
          } catch {
            // Cancellation and pre-commit handler failure leave the entry unchanged.
          }
          return;
        }

        if (mode === "commit-then-fail") {
          let didEmitNavigationError = false;
          const navigationError = new Promise((resolve) => {
            window.navigation.addEventListener(
              "navigateerror",
              () => {
                didEmitNavigationError = true;
                resolve();
              },
              { once: true },
            );
          });
          const failAfterCommit = (event) => {
            if (event.destination.url !== targetUrl) return;
            window.navigation.removeEventListener("navigate", failAfterCommit);
            event.intercept({
              handler: async () => {
                throw new Error("Controlled post-commit navigation failure");
              },
            });
          };
          window.navigation.addEventListener("navigate", failAfterCommit);
          const result = window.navigation.navigate(targetUrl);
          const timeout = (stage) =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timed out waiting for ${stage}`)), 5000),
            );
          await Promise.race([result.committed, timeout("navigation commit")]);
          if (window.navigation.currentEntry?.url !== targetUrl) {
            throw new Error("Navigation did not commit the expected current entry");
          }
          try {
            await Promise.race([result.finished, timeout("intercepted handler failure")]);
          } catch {
            // The intercepted handler fails after the entry has committed.
          }
          if (!didEmitNavigationError) {
            await Promise.race([navigationError, timeout("navigateerror event")]);
          }

          return;
        }

        const finishSuccessfully = (event) => {
          if (event.destination.url !== targetUrl) return;
          window.navigation.removeEventListener("navigate", finishSuccessfully);
          event.intercept({ handler: async () => {} });
        };
        window.navigation.addEventListener("navigate", finishSuccessfully);
        await window.navigation.navigate(targetUrl).finished;
      },
      { targetUrl: target, mode: scenario.mode },
    );

    const expectedUrl = scenario.expectedCount === 1 ? target : baseUrl + "/";
    await expect(page).toHaveURL(expectedUrl);
    const entryUrl = await page.evaluate(() => window.navigation.currentEntry?.url);
    if (entryUrl !== expectedUrl) {
      throw new Error(`${scenario.name}: current entry was ${entryUrl}, expected ${expectedUrl}`);
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (
        parseNavigationEvents(await events.textContent()).length >=
        before.length + scenario.expectedCount
      ) {
        break;
      }
      await page.waitForTimeout(50);
    }
    if (
      parseNavigationEvents(await events.textContent()).length !==
      before.length + scenario.expectedCount
    ) {
      navigationTrace.push(...(await page.evaluate(() => window.__navigationTrace)));
      throw new Error(
        `${scenario.name}: expected ${scenario.expectedCount} observer events, received ${JSON.stringify(parseNavigationEvents(await events.textContent()))}; Navigation API trace: ${JSON.stringify(navigationTrace)}`,
      );
    }
    const after = parseNavigationEvents(await events.textContent());
    if (scenario.expectedCount === 1) {
      const reported = after.find((event) => event.url === target);
      if (reported?.url !== target || reported.navigationType !== "push") {
        throw new Error(
          `${scenario.name}: expected one push event for ${target}, received ${JSON.stringify(reported)}`,
        );
      }
    } else if (after.length !== before.length) {
      throw new Error(`${scenario.name}: observer emitted an event for an uncommitted navigation`);
    }
  }
}

async function expectSingleInitialPageView(page, navigationEvents, pageViews) {
  await expect
    .poll(
      async () =>
        parseNavigationEvents(await navigationEvents.textContent()).filter(
          (event) => event.navigationType === "initial",
        ).length,
      { message: `exactly one initial observer event on ${page.url()}` },
    )
    .toBe(1);
  await expect
    .poll(async () => countPageViews(await pageViews.textContent()), {
      message: `exactly one initial page view on ${page.url()}`,
    })
    .toBe(1);
}

async function expectNavigationTitle(eventsLocator, urlPart, title, navigationType = "push") {
  await expect
    .poll(async () => {
      const events = parseNavigationEvents(await eventsLocator.textContent());

      return events.find(
        (event) => event.url.includes(urlPart) && event.navigationType === navigationType,
      )?.title;
    })
    .toBe(title);
}

async function expectNavigationEvent(eventsLocator, pathname, navigationType) {
  await expect
    .poll(async () => {
      const events = parseNavigationEvents(await eventsLocator.textContent());

      return events.some((event) => {
        try {
          return (
            new URL(event.url).pathname === pathname && event.navigationType === navigationType
          );
        } catch {
          return false;
        }
      });
    })
    .toBe(true);
}

function countPageViews(text) {
  if (text && /^\d+$/.test(text.trim())) return Number(text.trim());

  return (text?.match(/"type":"page_view"/g) ?? []).length;
}

function parseNavigationEvents(text) {
  try {
    return JSON.parse(text ?? "[]");
  } catch {
    return [];
  }
}
