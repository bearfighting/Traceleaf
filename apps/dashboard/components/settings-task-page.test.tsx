import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/site-management/client", () => ({ loadSiteDirectory: vi.fn() }));
vi.mock("../lib/configuration-api/server", () => ({
  getConfigurationEnvironment: vi.fn(() => "production"),
  loadSiteCapabilities: vi.fn(),
  loadSiteConfiguration: vi.fn(),
}));
vi.mock("./dashboard-shell", () => ({
  DashboardHeader: () => <header />,
  DashboardShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./configuration-editor", () => ({
  ConfigurationEditor: ({
    section,
    siteId,
    environment,
    result,
  }: {
    section: string;
    siteId: string;
    environment: string;
    result: { message?: string };
  }) => <div>{`${section}:${siteId}:${environment}:${result.message ?? ""}`}</div>,
}));
vi.mock("./ingest-keys-manager", () => ({
  IngestKeysManager: ({ siteId, environment }: { siteId: string; environment: string }) => (
    <div>{`keys:${siteId}:${environment}`}</div>
  ),
}));
vi.mock("./environment-selector", () => ({
  EnvironmentSelector: ({ value }: { value: string }) => (
    <label>
      Environment
      <input value={value} readOnly />
    </label>
  ),
}));

import { loadSiteCapabilities, loadSiteConfiguration } from "../lib/configuration-api/server";
import { loadSiteDirectory } from "../lib/site-management/client";

import { SettingsTaskPage } from "./settings-task-page";

const site = {
  site_id: "site_alpha",
  display_name: "Alpha",
  website_url: "https://alpha.example",
  lifecycle_status: "active" as const,
  setup_status: "ready" as const,
  missing_requirements: [],
  version: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

afterEach(() => vi.resetAllMocks());

describe("SettingsTaskPage", () => {
  it.each([
    ["capabilities", "site_alpha", "preview"],
    ["environments", "site_alpha", "staging"],
    ["ingest-keys", "site_alpha", "production"],
  ] as const)("keeps Site and Environment context on %s", async (section, siteId, environment) => {
    vi.mocked(loadSiteDirectory).mockResolvedValue({ kind: "ready", sites: [site] });
    vi.mocked(loadSiteCapabilities).mockResolvedValue({ kind: "error", message: "Unavailable" });
    vi.mocked(loadSiteConfiguration).mockResolvedValue({ kind: "error", message: "Unavailable" });

    const markup = renderToStaticMarkup(
      await SettingsTaskPage({
        section,
        searchParams: Promise.resolve({ site_id: siteId, environment }),
      }),
    );

    expect(markup).toContain("Alpha");
    expect(markup).toContain(environment);
    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-label="Settings navigation"');
    expect(markup).toContain('aria-current="page"');
    if (section === "ingest-keys") expect(markup).toContain("keys:site_alpha:production");
    if (section === "capabilities") expect(markup).toContain("capabilities:site_alpha:preview");
    if (section === "environments") expect(markup).toContain("environments:site_alpha:staging");
  });

  it("keeps policy unavailable status visible and still renders the Environment form", async () => {
    vi.mocked(loadSiteDirectory).mockResolvedValue({ kind: "ready", sites: [site] });
    vi.mocked(loadSiteConfiguration).mockResolvedValue({
      kind: "error",
      message: "Policy service unavailable",
    });

    const markup = renderToStaticMarkup(
      await SettingsTaskPage({
        section: "environments",
        searchParams: Promise.resolve({ site_id: "site_alpha", environment: "preview" }),
      }),
    );

    expect(markup).toContain("Environment");
    expect(markup).toContain("Policy service unavailable");
  });
});
