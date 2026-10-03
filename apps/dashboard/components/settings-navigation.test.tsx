import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsNavigation } from "./settings-navigation";

describe("SettingsNavigation", () => {
  it("shows the current task, Site, and Environment", () => {
    const markup = renderToStaticMarkup(
      <SettingsNavigation
        context={{ siteId: "site_alpha", environment: "production" }}
        environment="production"
        site={{
          site_id: "site_alpha",
          display_name: "Alpha",
          website_url: "https://alpha.example",
          lifecycle_status: "active",
          setup_status: "ready",
          missing_requirements: [],
          version: 1,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        }}
      />,
    );

    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-label="Settings navigation"');
    expect(markup).toContain('aria-current="page">Overview</span>');
    expect(markup).toContain("Alpha");
    expect(markup).toContain("production");
  });

  it("marks the active task and preserves context in the other task links", () => {
    const markup = renderToStaticMarkup(
      <SettingsNavigation
        context={{ siteId: "site_alpha", environment: "preview" }}
        environment="preview"
        section="environments"
      />,
    );
    expect(markup).toContain('aria-current="page">Environments &amp; Origins');
    expect(markup).toContain(
      "/dashboard/settings/capabilities?site_id=site_alpha&amp;environment=preview",
    );
  });

  it("exposes an addressable Ingest Keys task with the current Site and Environment", () => {
    const markup = renderToStaticMarkup(
      <SettingsNavigation
        context={{ siteId: "site_alpha", environment: "preview" }}
        section="ingest-keys"
      />,
    );
    expect(markup).toContain('aria-current="page">Ingest Keys');
    expect(markup).toContain(
      "/dashboard/settings/ingest-keys?site_id=site_alpha&amp;environment=preview",
    );
  });
});
