import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardLoading from "../app/dashboard/loading";
import SettingsLoading from "../app/dashboard/settings/loading";

const navigationState = vi.hoisted(() => ({ query: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationState.query),
}));

import { DashboardLoadingHeader } from "./dashboard-loading-header";

describe("DashboardLoadingHeader", () => {
  beforeEach(() => {
    navigationState.query = "";
  });

  it("preserves the Site and Settings context in both navigation links while loading", () => {
    navigationState.query =
      "site_id=site_alpha&environment=staging&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2";

    const markup = renderToStaticMarkup(<DashboardLoadingHeader settingsMode />);

    expect(markup).toContain(
      'href="/dashboard?site_id=site_alpha&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
    );
    expect(markup).toContain(
      'href="/dashboard/settings/overview?site_id=site_alpha&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
    );
  });

  it("provides usable default links when no Site context is present", () => {
    const markup = renderToStaticMarkup(<DashboardLoadingHeader />);

    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/dashboard/settings/overview"');
  });

  it("marks Analytics active when used by the Dashboard loading shell", () => {
    navigationState.query = "site_id=site_alpha&environment=staging";

    const markup = renderToStaticMarkup(<DashboardLoadingHeader />);

    expect(markup).toContain('aria-current="page" href="/dashboard?site_id=site_alpha');
    expect(markup).toContain(
      'href="/dashboard/settings/overview?site_id=site_alpha&amp;environment=staging"',
    );
  });

  it("wires both loading shells to context-aware primary navigation", () => {
    navigationState.query =
      "site_id=site_alpha&environment=staging&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2";

    const dashboardMarkup = renderToStaticMarkup(<DashboardLoading />);
    expect(dashboardMarkup).toContain("Loading reports for the selected site.");
    expect(dashboardMarkup).toContain('aria-current="page" href="/dashboard?site_id=site_alpha');
    expect(dashboardMarkup).toContain(
      'href="/dashboard/settings/overview?site_id=site_alpha&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
    );
    expect(dashboardMarkup).not.toContain('aria-label="Analytics navigation"');

    const settingsMarkup = renderToStaticMarkup(<SettingsLoading />);
    expect(settingsMarkup).toContain("Loading configuration for the selected site.");
    expect(settingsMarkup).toContain('aria-current="page" href="/dashboard/settings/overview');
    expect(settingsMarkup).toContain(
      'href="/dashboard?site_id=site_alpha&amp;environment=staging&amp;from=2026-09-01&amp;to=2026-09-30&amp;dimension=browser&amp;definition_version=r2"',
    );
  });
});
