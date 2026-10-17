import { expect, test } from "@playwright/test";

const locales = [
  { path: "/", title: "Page Views by day", pages: "Top Pages" },
  { path: "/product", title: "Page Views by day", pages: "Top Pages" },
  { path: "/zh-cn", title: "每日页面浏览量", pages: "热门页面" },
  { path: "/zh-cn/product", title: "每日页面浏览量", pages: "热门页面" },
];

for (const route of locales) {
  test(`preview content and controls on ${route.path}`, async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydration|did not match|server rendered/i.test(message.text())
      ) {
        hydrationErrors.push(message.text());
      }
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(route.path);
    await expect(
      page.getByRole("banner").getByRole("link", {
        name: route.path.startsWith("/zh-cn") ? "Traceleaf 首页" : "Traceleaf home",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").locator("img[src='/traceleaf-symbol.svg']"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: route.title })).toBeVisible();
    await expect(page.locator(".preview-date-range")).toHaveText(
      route.path.startsWith("/zh-cn") ? "2026年10月10日–16日" : "Oct 10–16, 2026",
    );
    await expect(page.getByRole("region", { name: new RegExp(route.pages) })).toBeVisible();
    await expect(page.getByText("8,492", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("progressbar")).toHaveCount(3);
    await expect(
      page
        .getByRole("list", { name: /Daily Page Views|每日页面浏览量示例数值/ })
        .getByRole("listitem"),
    ).toHaveCount(7);
    const axisLabelsFitChart = await page.locator(".preview-chart").evaluate((svg) => {
      const { width, height } = svg.viewBox.baseVal;
      return Array.from(svg.querySelectorAll("text")).every((label) => {
        const bounds = label.getBBox();
        return (
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= height
        );
      });
    });
    expect(axisLabelsFitChart).toBe(true);
    await expect(page.getByText(/Avg\. visit duration|平均访问时长|\+12\.8%/)).toHaveCount(0);

    const pauseButton = page.getByRole("button", { name: /^(Preview animation|预览动画)$/ });
    await pauseButton.focus();
    await expect(pauseButton).toBeFocused();
    await expect(pauseButton).toHaveCSS("outline-style", "solid");
    await expect(pauseButton).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(pauseButton).toHaveAttribute("aria-pressed", "false");
    await expect(pauseButton).toContainText(/Resume|继续/);
    const getBarAnimationStates = () =>
      page
        .locator(".page-bar")
        .first()
        .evaluate((element) => element.getAnimations().map((animation) => animation.playState));
    await expect.poll(getBarAnimationStates).toContain("paused");
    await page.keyboard.press("Enter");
    await expect(pauseButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(getBarAnimationStates).toContain("running");
    await page.keyboard.press("Enter");
    await expect(pauseButton).toHaveAttribute("aria-pressed", "false");
    const replayButton = page.getByRole("button", {
      name: /Replay preview animation|重播预览动画/,
    });
    await page.keyboard.press("Tab");
    await expect(replayButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pauseButton).toHaveAttribute("aria-pressed", "true");
    await expect(pauseButton).toContainText(/Pause|暂停/);
    expect(hydrationErrors).toEqual([]);
  });
}

test("preview stays light and fits a narrow viewport with reduced motion", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|did not match|server rendered|attributes/i.test(message.text())
    ) {
      hydrationErrors.push(message.text());
    }
  });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(page.locator(".product-preview-card")).toHaveCSS(
    "background-color",
    "rgb(245, 247, 251)",
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await expect(page.locator(".preview-content .metric-card").first()).toHaveCSS("opacity", "1");
  expect(hydrationErrors).toEqual([]);
  await context.close();
});

test("localized pages expose the shared brand icon and metadata", async ({ page }) => {
  for (const route of [
    {
      path: "/",
      title: "Traceleaf — self-hosted web analytics",
      description:
        "Self-hosted web analytics for developers who want control over their data and infrastructure.",
    },
    {
      path: "/zh-cn",
      title: "Traceleaf — 自托管网站分析 | Traceleaf",
      description: "面向开发者的自托管网站分析，让数据和基础设施保持在自己的掌控之中。",
    },
  ]) {
    await page.goto(route.path);
    await expect(page).toHaveTitle(route.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      route.description,
    );
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /icon\.svg/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      /apple-icon/,
    );
    await expect(
      page.getByRole("contentinfo").getByRole("link", {
        name: route.path === "/" ? "Traceleaf home" : "Traceleaf 首页",
      }),
    ).toBeVisible();
  }
});

test("brand header fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Traceleaf home" }),
  ).toBeVisible();
  await expect(page.getByRole("banner").locator("img[src='/traceleaf-symbol.svg']")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("sample metrics remain visible before client-side animation runs", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("24,680", { exact: true })).toBeVisible();
  await expect(page.getByText("8,492", { exact: true }).first()).toBeVisible();
  await context.close();
});
