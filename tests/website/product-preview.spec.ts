import { expect, test } from "@playwright/test";

const locales = [
  { path: "/", title: "Page Views by day", pages: "Top Pages" },
  { path: "/product", title: "Page Views by day", pages: "Top Pages" },
  { path: "/zh-cn", title: "每日页面浏览量", pages: "热门页面" },
  { path: "/zh-cn/product", title: "每日页面浏览量", pages: "热门页面" },
];

for (const route of locales) {
  test(`preview content and controls on ${route.path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.title })).toBeVisible();
    await expect(page.locator(".preview-date-range")).toContainText("2026");
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
  });
}

test("preview stays light and fits a narrow viewport with reduced motion", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
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
  await context.close();
});

test("sample metrics remain visible before client-side animation runs", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("24,680", { exact: true })).toBeVisible();
  await expect(page.getByText("8,492", { exact: true }).first()).toBeVisible();
  await context.close();
});
