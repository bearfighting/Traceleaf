import { expect } from "@playwright/test";

export async function runSettingsScenario(context, scenario) {
  const {
    page,
    assert,
    dashboardUrl,
    assertSettingsSectionFitsViewport,
    runCompose,
    browserContext,
    browser,
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
  } = context;

  async function assertDashboardConfiguration(page) {
    await page.goto(`${dashboardUrl}/dashboard/settings/capabilities?site_id=site_playground`);
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

    await page.goto(
      `${dashboardUrl}/dashboard/settings/environments?site_id=site_playground&environment=staging`,
    );
    await page.getByRole("heading", { name: "Environments & Origins" }).waitFor();
    await page.getByRole("textbox", { name: "Environment name" }).fill("config-e2e");
    await page.getByRole("button", { name: "Load environment" }).click();
    await page.waitForURL(/environment=config-e2e/);
    await page.getByRole("heading", { name: "Website access" }).waitFor();
    const environmentPolicySection = page.locator("#environment-policy");
    await assertSettingsSectionFitsViewport(
      page,
      environmentPolicySection,
      "Mobile Environment policy form",
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

    await page.goto(
      `${dashboardUrl}/dashboard/settings/ingest-keys?site_id=site_playground&environment=config-e2e`,
    );
    await page.getByRole("heading", { name: "Ingest Keys" }).waitFor();
    const ingestKeySection = page.locator('[aria-label="Ingest Keys"]');
    await page.getByRole("button", { name: "Create Ingest Key" }).waitFor();
    await assertSettingsSectionFitsViewport(page, ingestKeySection, "Mobile Ingest Keys section");
    await page.getByRole("button", { name: "Create Ingest Key" }).click();
    const displayedKey = page.locator(".one-time-secret code");
    await displayedKey.waitFor();
    await assertSettingsSectionFitsViewport(
      page,
      ingestKeySection,
      "Mobile Ingest Keys section with one-time secret",
    );
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
    assert(
      !(await page.evaluate(() => JSON.stringify(localStorage))).includes(plaintext),
      "Ingest Key plaintext was persisted in browser storage",
    );
    await page.getByRole("button", { name: "Create replacement key" }).click();
    await page.locator(".one-time-secret code").waitFor();
    await expect(page.locator(".key-list li")).toHaveCount(2);
    await page.route(
      `**/api/admin/sites/site_playground/environments/config-e2e/ingest-keys`,
      async (route) => {
        await route.fetch();
        await route.abort();
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Create replacement key" }).click();
    await page.getByText(/may have completed without a confirmed response/).waitFor();
    await expect(page.locator(".key-list li")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Create replacement key" })).toBeDisabled();
    await page.reload();
    await page.getByRole("button", { name: "Refresh active key list" }).click();
    await expect(page.locator(".key-list li")).toHaveCount(3);
    await page.getByRole("button", { name: "I checked the key list" }).click();
    await expect(page.locator(".key-list li")).toHaveCount(3);
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
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Revoke / })
      .click();
    await expect(page.locator(".key-list li")).toHaveCount(2);
    await page.locator(".key-list li").first().getByRole("button", { name: "Revoke" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Revoke / })
      .click();
    await expect(page.locator(".key-list li")).toHaveCount(1);
    await page.locator(".key-list li").first().getByRole("button", { name: "Revoke" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Revoke / })
      .click();
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

    await page.goto(`${dashboardUrl}/dashboard/settings/definitions?site_id=site_playground`);
    const editor = page.locator('section[aria-label="Conversion and funnel definitions"]');
    await expect(editor.getByRole("button", { name: "Save new revision" })).toBeVisible();
    await assertSettingsSectionFitsViewport(page, editor, "Mobile Definitions form");
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
    const savedHistory = page.locator('section[aria-label="Definition revision history"]');
    await savedHistory
      .getByRole("link", { name: `Revision ${saved.revision} · ${saved.definition_version}` })
      .waitFor();
    assert(
      (await savedHistory.innerText()).includes(`Current revision: ${saved.definition_version}`),
      "Definition revision history did not refresh after a successful save",
    );
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
    assert(
      (await (await conflictResponse).status()) === 409,
      "Stale revision must return HTTP 409",
    );
    await conflictEditor
      .getByRole("alert")
      .getByRole("button", { name: "Reload latest definitions" })
      .waitFor();
    await conflictEditor.getByRole("button", { name: "Reload latest definitions" }).click();
    const discardDraftDialog = conflictEditor.getByRole("alertdialog");
    await discardDraftDialog.waitFor();
    assert(
      (await conflictConversion.getByLabel("Name", { exact: true }).inputValue()) ===
        "Unsaved local draft",
      "Opening the conflict confirmation should preserve the local draft",
    );
    assert(
      (await discardDraftDialog.innerText()).includes("discard your unsaved changes"),
      "Conflict reload did not explain that the local draft will be discarded",
    );
    await discardDraftDialog.getByRole("button", { name: "Cancel" }).click();
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
      .getByRole("alertdialog")
      .getByRole("button", { name: "Reload definitions" })
      .click();
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
      await fetch(
        `${reportPath}?definition_version=${encodeURIComponent(importedDefinitionVersion)}`,
      )
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
      `${dashboardUrl}/dashboard/conversions?site_id=site_playground&from=2026-09-20&to=2026-09-21&definition_version=${encodeURIComponent(importedDefinitionVersion)}`,
    );
    await page
      .getByText(`Definition revision: ${importedDefinitionVersion}`, { exact: true })
      .first()
      .waitFor();
    await page.goto(
      `${dashboardUrl}/dashboard/funnels?site_id=site_playground&from=2026-09-20&to=2026-09-21&definition_version=${encodeURIComponent(importedDefinitionVersion)}`,
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
      await waitForHttpService("Dashboard error instance", `${errorUrl}/dashboard`);
      const page = await browser.newPage();
      await page.goto(
        `${errorUrl}/dashboard?site_id=site_playground&from=2026-09-18&to=2026-09-18`,
      );
      const directoryError = page
        .locator('[aria-label="Site directory status"]')
        .getByRole("alert");
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
  const scenarios = {
    definitions: () => assertDefinitionManagement(page),
    configuration: () => assertDashboardConfiguration(page),
    apiError: () => assertApiError(browser),
  };
  const execute = scenarios[scenario];
  if (!execute) throw new Error(`Unknown Dashboard settings scenario: ${scenario}`);
  await execute();
}
