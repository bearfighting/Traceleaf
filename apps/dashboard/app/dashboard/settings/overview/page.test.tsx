import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/sites/site-management/client", () => ({
  loadSiteDirectory: vi.fn(),
}));
vi.mock("../../../../lib/settings/configuration-api/server", () => ({
  getConfigurationEnvironment: vi.fn(() => "production"),
  loadSiteConfiguration: vi.fn(),
}));
vi.mock("../../../../lib/analytics/analytics-api/client", () => ({
  createAnalyticsApiClient: vi.fn(() => ({
    overview: vi.fn().mockResolvedValue({ page_views: 0 }),
  })),
}));
vi.mock("../../../../lib/analytics/analytics-api/config", () => ({
  getAnalyticsApiUrl: vi.fn(() => "http://analytics.test"),
}));
vi.mock("../../../../components/shared/dashboard-shell", () => ({
  DashboardHeader: ({
    analyticsHref,
    settingsHref,
  }: {
    analyticsHref: string;
    settingsHref: string;
  }) => (
    <header>
      <a href={analyticsHref}>Analytics</a>
      <a href={settingsHref}>Settings</a>
    </header>
  ),
  DashboardShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../../components/sites/site-connection-status", () => ({
  SiteConnectionStatus: () => <div>Connection summary</div>,
}));
vi.mock("../../../../components/settings/configuration-editor", () => ({
  ConfigurationEditor: () => <div>Configuration controls</div>,
}));
import { loadSiteConfiguration } from "../../../../lib/settings/configuration-api/server";
import {
  loadSiteDirectory,
  type SiteDirectoryResult,
} from "../../../../lib/sites/site-management/client";

import SettingsPage from "./page";

afterEach(() => vi.resetAllMocks());

const contextParams = {
  site_id: "site_missing",
  environment: "staging",
  from: "2026-09-01",
  to: "2026-09-30",
  dimension: "browser",
  definition_version: "r2",
};

const directoryStates: Array<[string, SiteDirectoryResult]> = [
  ["empty Registry", { kind: "ready", sites: [] }],
  ["Registry API error", { kind: "unavailable", message: "Registry is offline." }],
];

describe("SettingsPage status navigation", () => {
  it.each(directoryStates)("preserves route context for %s", async (_state, directory) => {
    vi.mocked(loadSiteDirectory).mockResolvedValue(directory);

    const element = await SettingsPage({ searchParams: Promise.resolve(contextParams) });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(
      'href="/dashboard?site_id=site_missing&amp;from=2026-09-01&amp;to=2026-09-30&amp;environment=staging"',
    );
    expect(markup).toContain(
      'href="/dashboard/settings/overview?site_id=site_missing&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
    );
  });

  it("preserves route context for an unknown Site", async () => {
    vi.mocked(loadSiteDirectory).mockResolvedValue({
      kind: "ready",
      sites: [
        {
          site_id: "site_alpha",
          display_name: "Alpha",
          website_url: "https://alpha.example",
          lifecycle_status: "active",
          setup_status: "ready",
          missing_requirements: [],
          version: 1,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    });

    const element = await SettingsPage({
      searchParams: Promise.resolve({ ...contextParams, site_id: "site_unknown" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(
      'href="/dashboard?site_id=site_unknown&amp;from=2026-09-01&amp;to=2026-09-30&amp;environment=staging"',
    );
  });

  it("renders the Site summary and connection summary without definition controls", async () => {
    vi.mocked(loadSiteDirectory).mockResolvedValue({
      kind: "ready",
      sites: [
        {
          site_id: "site_alpha",
          display_name: "Alpha Analytics",
          website_url: "https://alpha.example",
          lifecycle_status: "active",
          setup_status: "ready",
          missing_requirements: [],
          version: 1,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(loadSiteConfiguration).mockResolvedValue({
      kind: "error",
      message: "Configuration API unavailable",
    });
    const element = await SettingsPage({
      searchParams: Promise.resolve({ site_id: "site_alpha", environment: "staging" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("site_alpha");
    expect(markup).toContain("Alpha Analytics");
    expect(markup).toContain("https://alpha.example");
    expect(markup).toMatch(/<dt>Lifecycle:<\/dt>\s*<dd>active<\/dd>/);
    expect(markup).toMatch(/<dt>Setup readiness:<\/dt>\s*<dd>ready<\/dd>/);
    expect(markup).toMatch(/<dt>Environment:<\/dt>\s*<dd>staging<\/dd>/);
    expect(markup).toContain("Connection summary");
    expect(markup).not.toContain("Configuration controls");
    expect(loadSiteConfiguration).toHaveBeenCalledWith("site_alpha", "staging");
  });
});
