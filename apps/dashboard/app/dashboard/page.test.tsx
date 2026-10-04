import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import DashboardPage, { DashboardRouteContent, metadata } from "./page";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("DashboardPage server contract", () => {
  it("sets the Overview document title", () => {
    expect(metadata.title).toBe("Overview");
  });

  const site = {
    site_id: "site_playground",
    display_name: "Playground",
    website_url: "https://playground.example",
    lifecycle_status: "active",
    setup_status: "ready",
    missing_requirements: [],
    version: 1,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };

  function configureRegistry(response: Response) {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "server-token");
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    return fetchMock;
  }

  it.each([
    ["unknown site", { site_id: "site_unknown" }, "is not present in the Site Registry"],
    ["partial date range", { from: "2026-09-01" }, "Both from and to dates are required"],
  ])("does not query Analytics API for %s", async (_caseName, searchParams, message) => {
    const fetchMock = configureRegistry(Response.json({ items: [site], next_cursor: null }));

    const element = await DashboardPage({ searchParams: Promise.resolve(searchParams) });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(message);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps Environment in the Settings link when returning from Analytics", async () => {
    configureRegistry(Response.json({ items: [site], next_cursor: null }));

    const element = await DashboardPage({
      searchParams: Promise.resolve({ site_id: "site_playground", environment: "staging" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(
      'href="/dashboard/settings/overview?site_id=site_playground&amp;environment=staging&amp;from=',
    );
  });

  it("renders an empty registry distinctly from management errors", async () => {
    configureRegistry(Response.json({ items: [], next_cursor: null }));
    const element = await DashboardPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("No Sites registered");
    expect(markup).not.toContain("Site directory unavailable");
  });

  it("does not present unauthorized management access as an empty registry", async () => {
    configureRegistry(
      Response.json({ error: { message: "Admin token rejected." } }, { status: 401 }),
    );
    const element = await DashboardPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("Site directory unavailable");
    expect(markup).toContain("Admin token rejected.");
    expect(markup).not.toContain("No Sites registered");
  });

  it("keeps the report title and description on a Site Registry error state", async () => {
    configureRegistry(
      Response.json({ error: { message: "Site management is unavailable." } }, { status: 503 }),
    );

    const element = await DashboardRouteContent({
      searchParams: Promise.resolve({}),
      report: "pages",
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(">Pages</h1>");
    expect(markup).toContain("Page view trends and the most visited paths.");
  });
});
