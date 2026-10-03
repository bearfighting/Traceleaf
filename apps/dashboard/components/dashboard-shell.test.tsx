import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  it("renders the shared navigation and preserves analytics query state", () => {
    const markup = renderToStaticMarkup(
      <DashboardShell
        dateRange={{ from: "2026-09-01", to: "2026-09-30" }}
        definitionVersion="definitions-v2"
        definitionVersions={[{ version: "definitions-v2", revision: 2 }]}
        dimension="browser"
        environment="staging"
        siteId="site_playground"
        sites={[
          { id: "site_playground", label: "Playground" },
          { id: "site_alpha", label: "Alpha" },
        ]}
      >
        <div id="overview">Report content</div>
      </DashboardShell>,
    );

    expect(markup).toContain("Web Analytics");
    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain(
      'href="/dashboard?site_id=site_playground&amp;from=2026-09-01&amp;to=2026-09-30&amp;environment=staging"',
    );
    expect(markup).toContain(
      'href="/dashboard/settings/overview?site_id=site_playground&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30"',
    );
    expect(markup).toContain('action="/dashboard"');
    expect(markup).not.toContain('name="definition_version"');
    expect(markup).toContain('name="environment" value="staging"');
    expect(markup).not.toContain('name="dimension"');
    expect(markup).toContain('name="site_id"');
  });

  it.each(["pages", "dimensions", "conversions", "funnels"])(
    "shows only filters supported by %s",
    (report) => {
      const markup = renderToStaticMarkup(
        <DashboardShell
          dateRange={{ from: "2026-09-01", to: "2026-09-30" }}
          definitionVersion="definitions-v2"
          definitionVersions={[{ version: "definitions-v2", revision: 2 }]}
          dimension="browser"
          report={report}
          siteId="site_playground"
          sites={[{ id: "site_playground", label: "Playground" }]}
        >
          <div />
        </DashboardShell>,
      );
      expect(markup).toContain('name="site_id"');
      expect(markup).toContain('name="from"');
      expect(markup).toContain('name="to"');
      expect(markup.includes('name="dimension"')).toBe(report === "dimensions");
      expect(markup.includes('name="definition_version"')).toBe(
        report === "conversions" || report === "funnels",
      );
    },
  );

  it("omits the Analytics report sidebar in Settings mode", () => {
    const markup = renderToStaticMarkup(
      <DashboardShell
        dateRange={{ from: "2026-09-01", to: "2026-09-30" }}
        definitionVersion="definitions-v2"
        dimension="browser"
        environment="staging"
        settingsMode
        siteId="site_playground"
        sites={[{ id: "site_playground", label: "Playground" }]}
      >
        <div>Settings content</div>
      </DashboardShell>,
    );

    expect(markup).toContain("Site settings");
    expect(markup).not.toContain('aria-label="Analytics navigation"');
    expect(markup).toContain('action="/dashboard/settings/overview"');
    expect(markup).toContain(
      'href="/dashboard?site_id=site_playground&amp;from=2026-09-01&amp;to=2026-09-30&amp;environment=staging"',
    );
    expect(markup).toContain(
      'href="/dashboard/settings/overview?site_id=site_playground&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30"',
    );
    expect(markup).toContain('name="from" value="2026-09-01"');
    expect(markup).toContain('name="definition_version" value="definitions-v2"');
    expect(markup).toContain('name="environment" value="staging"');
  });

  it.each(["capabilities", "environments"] as const)(
    "keeps the %s Settings task and Environment when selecting a Site",
    (settingsSection) => {
      const markup = renderToStaticMarkup(
        <DashboardShell
          dateRange={{ from: "", to: "" }}
          dimension="browser"
          environment="staging"
          settingsMode
          settingsSection={settingsSection}
          siteId="site_playground"
          sites={[
            { id: "site_playground", label: "Playground" },
            { id: "site_alpha", label: "Alpha" },
          ]}
        >
          <div>Settings task</div>
        </DashboardShell>,
      );

      expect(markup).toContain(`action="/dashboard/settings/${settingsSection}"`);
      expect(markup).toContain('name="environment" value="staging"');
      expect(markup).toContain(
        `href="/dashboard/settings/${settingsSection}?site_id=site_playground&amp;environment=staging"`,
      );
    },
  );
});
