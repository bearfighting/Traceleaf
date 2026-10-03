/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    throw new Promise(() => {});
  },
}));

vi.mock("./dashboard-shell", () => ({
  DashboardHeader: ({
    analyticsHref,
    settingsHref,
    settingsMode,
  }: {
    analyticsHref: string;
    settingsHref: string;
    settingsMode?: boolean;
  }) =>
    React.createElement(
      "nav",
      { "data-settings-mode": settingsMode ? "true" : "false" },
      React.createElement("a", { href: analyticsHref }, "Analytics"),
      React.createElement("a", { href: settingsHref }, "Settings"),
    ),
}));

import { DashboardLoadingHeader } from "./dashboard-loading-header";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("DashboardLoadingHeader Suspense fallback", () => {
  it("reads URL context in the fallback while useSearchParams suspends", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard?site_id=site_alpha&environment=staging&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2",
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<DashboardLoadingHeader />));

    expect(container.querySelector('a[href^="/dashboard?"]')?.getAttribute("href")).toBe(
      "/dashboard?site_id=site_alpha&environment=staging&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2",
    );
    expect(
      container.querySelector('a[href^="/dashboard/settings/overview"]')?.getAttribute("href"),
    ).toBe(
      "/dashboard/settings/overview?site_id=site_alpha&environment=staging&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2",
    );

    await act(async () => root.unmount());
  });

  it("updates fallback links after client-side history navigation", async () => {
    window.history.replaceState({}, "", "/dashboard?site_id=site_alpha&environment=staging");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<DashboardLoadingHeader />));
    await act(async () => {
      window.history.pushState(
        {},
        "",
        "/dashboard?site_id=site_beta&environment=production&dimension=country",
      );
    });

    expect(container.querySelector('a[href^="/dashboard?"]')?.getAttribute("href")).toBe(
      "/dashboard?site_id=site_beta&environment=production&dimension=country",
    );
    expect(
      container.querySelector('a[href^="/dashboard/settings/overview"]')?.getAttribute("href"),
    ).toBe(
      "/dashboard/settings/overview?site_id=site_beta&environment=production&dimension=country",
    );

    await act(async () => root.unmount());
  });
});
