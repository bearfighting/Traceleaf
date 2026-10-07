import { expect } from "@playwright/test";

export async function runReportScenario(context, scenario) {
  const {
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
  } = context;

  async function assertDashboardShell(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `${dashboardUrl}/dashboard?site_id=site_playground&environment=config-e2e&from=2026-09-20&to=2026-09-21&dimension=browser`,
    );
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.locator(".analytics-sidebar-desktop")).toBeVisible();
    await expect(page.locator(".analytics-sidebar-desktop a[href^='/dashboard?']")).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.locator(".analytics-sidebar-desktop a[href^='/dashboard/pages?']").click();
    await expect(page).toHaveURL(
      /\/dashboard\/pages\?(?=.*site_id=site_playground)(?=.*from=2026-09-20)(?=.*to=2026-09-21)(?=.*environment=config-e2e)/,
    );
    await expect(page.getByRole("heading", { name: "Pages", level: 1 })).toBeVisible();
    await expect(
      page.locator(".analytics-sidebar-desktop a[href^='/dashboard/pages?']"),
    ).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page.locator(".analytics-sidebar-desktop a[href^='/dashboard?']")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goForward();
    await expect(
      page.locator(".analytics-sidebar-desktop a[href^='/dashboard/pages?']"),
    ).toHaveAttribute("aria-current", "page");
    await page.locator('input[name="from"]').fill("2026-09-19");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard\/pages\?(?=.*from=2026-09-19)(?=.*to=2026-09-21)/);
    await page.goto(`${dashboardUrl}/dashboard/not-a-report`);
    await page.getByText("This page could not be found.", { exact: true }).waitFor();
    await page.goto(
      `${dashboardUrl}/dashboard/pages?site_id=site_playground&from=2026-09-20&to=2026-09-21&environment=config-e2e&dimension=browser`,
    );

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(
      /\/dashboard\/settings\/overview\?site_id=site_playground&environment=config-e2e&from=2026-09-20&to=2026-09-21/,
    );
    const desktopSettingsNavigation = page.getByRole("navigation", {
      name: "Settings navigation",
    });
    await desktopSettingsNavigation.getByRole("link", { name: "Capabilities" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/capabilities\?site_id=site_playground/);
    const desktopCapabilityForm = page.locator("#capabilities");
    await expect(
      desktopCapabilityForm.getByRole("heading", { name: "Site capabilities" }),
    ).toBeVisible();
    await expect(
      desktopCapabilityForm.getByRole("checkbox", { name: "Enable Page Views" }),
    ).toBeVisible();
    await expect(
      desktopCapabilityForm.getByRole("button", { name: "Save capabilities" }),
    ).toBeVisible();
    const desktopFormBounds = await desktopCapabilityForm.boundingBox();
    assert(
      desktopFormBounds &&
        desktopFormBounds.x >= 0 &&
        desktopFormBounds.x + desktopFormBounds.width <= 1440,
      "Capabilities form exceeds the 1440px viewport",
    );
    const desktopFormOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert(!desktopFormOverflow, "Capabilities form causes horizontal page overflow at 1440px");

    await page.goto(
      `${dashboardUrl}/dashboard/settings/environments?site_id=site_playground&environment=e2e`,
    );
    await expect(page.getByRole("heading", { name: "Website access" })).toBeVisible();
    const environmentForm = page.locator("#environment-policy");
    await expect(environmentForm.locator("textarea")).toBeVisible();
    await expect(
      environmentForm.getByRole("button", { name: "Save access settings" }),
    ).toBeVisible();
    await assertSettingsSectionFitsViewport(page, environmentForm, "Environment policy form");

    await page.goto(
      `${dashboardUrl}/dashboard/settings/ingest-keys?site_id=site_playground&environment=e2e`,
    );
    const ingestKeySection = page.locator('[aria-label="Ingest Keys"]');
    await expect(
      ingestKeySection.getByRole("button", { name: "Create replacement key" }),
    ).toBeVisible();
    await expect(ingestKeySection.locator(".key-list li")).toHaveCount(1);
    await assertSettingsSectionFitsViewport(page, ingestKeySection, "Ingest Keys section");

    await page.goto(
      `${dashboardUrl}/dashboard/settings/definitions?site_id=site_playground&environment=config-e2e&from=2026-09-20&to=2026-09-21&dimension=browser`,
    );
    const definitionsForm = page.locator('[aria-label="Conversion and funnel definitions"]');
    await expect(definitionsForm.getByRole("button", { name: "Save new revision" })).toBeVisible();
    await expect(definitionsForm.getByLabel("Name", { exact: true }).first()).toBeVisible();
    await assertSettingsSectionFitsViewport(page, definitionsForm, "Definitions form");

    const analyticsLink = page.getByRole("link", { name: "Analytics", exact: true });
    await expect(analyticsLink).toHaveAttribute(
      "href",
      /\/dashboard\?site_id=site_playground(?=.*environment=config-e2e)(?=.*from=2026-09-20)(?=.*to=2026-09-21)/,
    );
    await analyticsLink.click();
    await expect(page).toHaveURL(
      /\/dashboard\?site_id=site_playground(?=.*environment=config-e2e)(?=.*from=2026-09-20)(?=.*to=2026-09-21)/,
    );
    const settingsLink = page.getByRole("link", { name: "Settings", exact: true });
    await expect(settingsLink).toHaveAttribute(
      "href",
      /\/dashboard\/settings\/overview\?site_id=site_playground&environment=config-e2e/,
    );
    await settingsLink.click();
    await expect(page).toHaveURL(
      /\/dashboard\/settings\/overview\?site_id=site_playground&environment=config-e2e&from=2026-09-20&to=2026-09-21/,
    );

    await page.getByRole("link", { name: "Analytics", exact: true }).click();
    await expect(page.locator(".analytics-sidebar-desktop")).toBeVisible();

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
    await expect(page).toHaveURL(
      /\/dashboard\/dimensions\?(?=.*site_id=site_playground)(?=.*from=2026-09-20)(?=.*to=2026-09-21)/,
    );
    await expect(mobileMenu.locator("a[href^='/dashboard/dimensions?']")).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/overview\?/);
    const settingsNavigation = page.getByRole("navigation", { name: "Settings navigation" });
    await expect(settingsNavigation).toBeVisible();
    await expect(settingsNavigation.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const settingsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert(!settingsOverflow, "Settings navigation overflows the 390px viewport");
    const capabilitiesLink = settingsNavigation.getByRole("link", { name: "Capabilities" });
    await capabilitiesLink.focus();
    await page.keyboard.press("Tab");
    const environmentsLink = settingsNavigation.getByRole("link", {
      name: "Environments & Origins",
    });
    const focusOutline = await environmentsLink.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    );
    assert(focusOutline !== "none", "Settings navigation focus indicator is not visible");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/settings\/capabilities\?site_id=site_playground/);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
      "Capabilities",
    );
    const capabilityForm = page.locator("#capabilities");
    await expect(capabilityForm.getByRole("heading", { name: "Site capabilities" })).toBeVisible();
    await expect(capabilityForm.getByRole("checkbox", { name: "Enable Page Views" })).toBeVisible();
    await expect(capabilityForm.getByRole("button", { name: "Save capabilities" })).toBeVisible();
    const formBounds = await capabilityForm.boundingBox();
    assert(
      formBounds && formBounds.x >= 0 && formBounds.x + formBounds.width <= 390,
      "Capabilities form exceeds the 390px viewport width",
    );
    const formOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert(!formOverflow, "Capabilities form causes horizontal page overflow at 390px");
  }

  async function assertGeoCountries(page) {
    const data = await fixture("geo-countries");
    await prepareFixture(data);
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "countries"));
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
    await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01", "countries"));
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
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "pages"));
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

  async function assertMultiPageNavigation(page) {
    const data = await fixture("multi-page-navigation");
    const rangeOverview = expectedApi(data, "range_overview");
    const pages = expectedApi(data, "pages");
    await prepareFixture(data);
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18"));
    await expectMetric(page, "Selected range Page Views", rangeOverview.page_views);
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "pages"));
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
    await page.goto(rangeUrl("site_beta", "2026-09-18", "2026-09-18", "pages"));
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
    await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01", "pages"));
    await page.getByText("No page view data is available for this selection.").nth(0).waitFor();
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
    await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01", "web-vitals"));
    await page
      .locator("section.card")
      .filter({ hasText: "Web Vitals" })
      .getByText(emptyCopy)
      .waitFor();
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

  async function assertAudienceDimensionDashboard(page) {
    const data = await audienceDimensionFixture("dashboard-dimensions");
    await prepareAudienceDimensionFixture(data);
    await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21"));
    await expectMetric(page, "Unique Visitors", data.expected.visitors.unique_visitors);
    await expectMetric(page, "Sessions", data.expected.visitors.sessions);
    await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21", "visitors"));
    await expectReportRows(
      page,
      "Visitors",
      data.expected.visitors.items.map((item) => `${item.day} ${item.unique_visitors}`),
    );
    await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21", "dimensions"));
    await expectReportRows(page, "Dimension Report", [
      `${data.expected.browser.value} ${data.expected.browser.page_views} ${data.expected.browser.unique_visitors} ${data.expected.browser.sessions}`,
    ]);
    await page.locator(".freshness-current").first().waitFor();
    await page.locator('select[name="dimension"]').selectOption("language");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/dimension=language/);
    await expectReportRows(page, "Dimension Report", ["en-CA 3 1 2", "en-US 2 1 1"]);
  }

  async function assertAudienceDimensionReportsDisabled(page) {
    const data = await fixture("single-page-view");
    resetE2EBusinessData({ runCompose, project, scope: "dashboard" });
    await setAudienceDimensionReportsEnabled("site_playground", false);
    await postFixtureEvents(data.input);
    runProcessorOnce();
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "visitors"));
    const visitorsReport = page
      .locator("section.report-card")
      .filter({ has: page.getByRole("heading", { name: "Visitors", exact: true }) });
    await expect(
      visitorsReport.getByText("No analytics data is available for this selection."),
    ).toHaveCount(1);
  }

  async function assertAudienceDimensionDashboardEmpty(page) {
    const data = await audienceDimensionFixture("dashboard-dimensions");
    await prepareAudienceDimensionFixture(data);
    await page.goto(rangeUrl("site_playground", "2026-09-01", "2026-09-01", "visitors"));
    const visitorsReport = page
      .locator("section.report-card")
      .filter({ has: page.getByRole("heading", { name: "Visitors", exact: true }) });
    await expect(
      visitorsReport.getByText("No analytics data is available for this selection."),
    ).toHaveCount(1);
  }
  const scenarios = {
    shell: () => assertDashboardShell(page),
    singlePageView: () => assertSinglePageView(page),
    geoCountries: () => assertGeoCountries(page),
    multiPageNavigation: () => assertMultiPageNavigation(page),
    multiSiteIsolation: () => assertMultiSiteIsolation(page),
    emptyRange: () => assertEmptyRange(page),
    customDateRange: () => assertCustomDateRange(page),
    audienceDimensionsDisabled: () => assertAudienceDimensionReportsDisabled(page),
    audienceDimensions: () => assertAudienceDimensionDashboard(page),
    audienceDimensionsEmpty: () => assertAudienceDimensionDashboardEmpty(page),
  };
  const execute = scenarios[scenario];
  if (!execute) throw new Error(`Unknown Dashboard reports scenario: ${scenario}`);
  await execute();
}
