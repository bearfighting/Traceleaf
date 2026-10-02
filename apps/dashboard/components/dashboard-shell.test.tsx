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
        siteId="site_playground"
        sites={["site_playground", "site_alpha"]}
      >
        <div id="overview">Report content</div>
      </DashboardShell>,
    );

    expect(markup).toContain("Web Analytics");
    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain(
      'href="/dashboard?site_id=site_playground&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=definitions-v2"',
    );
    expect(markup).toContain(
      'href="/dashboard/settings?site_id=site_playground&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=definitions-v2"',
    );
    expect(markup).toContain('action="/dashboard"');
    expect(markup).toContain('name="definition_version"');
    expect(markup).toContain('name="dimension"');
    expect(markup).toContain('name="site_id"');
  });

  it("omits the Analytics report sidebar in Settings mode", () => {
    const markup = renderToStaticMarkup(
      <DashboardShell
        dateRange={{ from: "2026-09-01", to: "2026-09-30" }}
        definitionVersion="definitions-v2"
        dimension="browser"
        settingsMode
        siteId="site_playground"
        sites={["site_playground"]}
      >
        <div>Settings content</div>
      </DashboardShell>,
    );

    expect(markup).toContain("Site settings");
    expect(markup).not.toContain('aria-label="Analytics navigation"');
    expect(markup).toContain('action="/dashboard/settings"');
    expect(markup).toContain(
      'href="/dashboard?site_id=site_playground&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=definitions-v2"',
    );
    expect(markup).toContain('name="from" value="2026-09-01"');
    expect(markup).toContain('name="definition_version" value="definitions-v2"');
  });
});
