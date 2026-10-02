import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/site-management/client", () => ({
  loadSiteDirectory: vi.fn(),
}));

import {
  loadSiteDirectory,
  type SiteDirectoryResult,
} from "../../../../lib/site-management/client";

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
      'href="/dashboard?site_id=site_missing&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
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
      'href="/dashboard?site_id=site_unknown&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
    );
  });
});
