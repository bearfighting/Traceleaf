import { expect } from "@playwright/test";

export async function runEventScenario(context, scenario) {
  const {
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
  } = context;

  async function assertWebVitals(page) {
    const data = await fixture("web-vitals");
    await prepareFixture(data);
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "web-vitals"));
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
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "custom-events"));
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
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "conversions"));
    const conversions = page.locator("section.card").filter({
      has: page.getByRole("heading", { name: "Conversions", exact: true, level: 2 }),
    });
    await expectReportRows(page, "Conversions", ["purchase_completed 2026-09-18 1 0.0%"]);
    assert(
      !(await conversions.textContent()).includes("currency"),
      "Conversion properties must not be displayed",
    );
    await page.goto(rangeUrl("site_playground", "2026-09-18", "2026-09-18", "funnels"));
    const funnels = page.locator("section.card").filter({ hasText: "Funnels" });
    await funnels.getByText("No funnel data is available for this selection.").waitFor();
  }

  async function assertBackfilledConversionFunnels(page) {
    const data = await audienceDimensionFixture("dashboard-dimensions");
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

    // Process custom events before Sessions exist, then verify a direct audience-report
    // backfill relinks the derived Conversion and Funnel facts.
    await prepareFixture(data);
    await enableAudienceDimensionReports("site_playground");
    runProcessorBackfill("2026-09-20", "2026-09-21");
    runProcessorRebuildConversionFunnels("site_playground", importedDefinitionVersion);
    await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21", "conversions"));
    await expectReportRows(page, "Conversions", ["purchase_completed 2026-09-20 1 100.0%"]);
    await page.goto(rangeUrl("site_playground", "2026-09-20", "2026-09-21", "funnels"));
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
  const scenarios = {
    customEvents: () => assertCustomEvents(page),
    conversionFunnels: () => assertBackfilledConversionFunnels(page),
    webVitals: () => assertWebVitals(page),
  };
  const execute = scenarios[scenario];
  if (!execute) throw new Error(`Unknown Dashboard events scenario: ${scenario}`);
  await execute();
}
