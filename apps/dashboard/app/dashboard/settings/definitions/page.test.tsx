import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/site-management/client", () => ({ loadSiteDirectory: vi.fn() }));
vi.mock("../../../../lib/configuration-api/server", () => ({
  getConfigurationEnvironment: vi.fn(() => undefined),
  loadSiteDefinitions: vi.fn(),
}));
vi.mock("../../../../lib/dashboard-page-data", () => ({
  loadDefinitionRevisionHistory: vi.fn(),
}));
vi.mock("../../../../components/dashboard-shell", () => ({
  DashboardHeader: () => <header />,
  DashboardShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../../components/definition-editor", () => ({
  DefinitionEditor: () => <div>Definition editor</div>,
}));

import { loadSiteDefinitions } from "../../../../lib/configuration-api/server";
import { loadDefinitionRevisionHistory } from "../../../../lib/dashboard-page-data";
import { loadSiteDirectory } from "../../../../lib/site-management/client";

import DefinitionsPage from "./page";

afterEach(() => vi.resetAllMocks());

describe("DefinitionsPage", () => {
  it("renders the editor without an Environment and links historical revisions", async () => {
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
    vi.mocked(loadSiteDefinitions).mockResolvedValue({
      kind: "error",
      message: "Admin service unavailable",
    });
    vi.mocked(loadDefinitionRevisionHistory).mockResolvedValue({
      kind: "ready",
      currentVersion: "r2",
      revisions: [
        { version: "r2", revision: 2, effectiveAt: "2026-09-27T00:00:00Z" },
        { version: "r1", revision: 1, effectiveAt: null },
      ],
    });
    const element = await DefinitionsPage({
      searchParams: Promise.resolve({
        site_id: "site_alpha",
        from: "2026-09-01",
        dimension: "browser",
      }),
    });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("Current revision: r2");
    expect(markup).toContain("Effective");
    expect(markup).toContain(
      "/dashboard?site_id=site_alpha&amp;from=2026-09-01&amp;dimension=browser&amp;definition_version=r1",
    );
    expect(markup).toContain("Definition editor");
    expect(markup).not.toContain("DASHBOARD_DEFAULT_ENVIRONMENT");
  });
});
