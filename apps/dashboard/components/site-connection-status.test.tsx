// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { SiteConnectionStatus, connectionStatus } from "./site-connection-status";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";
import type { ManagedSite } from "../lib/site-management/client";

const site = (overrides: Partial<ManagedSite> = {}): ManagedSite => ({
  site_id: "site_demo",
  display_name: "Demo",
  website_url: "https://demo.test",
  lifecycle_status: "active",
  setup_status: "ready",
  missing_requirements: [],
  version: 1,
  created_at: "",
  updated_at: "",
  ...overrides,
});
const ready: ConfigurationLoadResult = {
  kind: "ready",
  capabilities: {
    configuration: {} as never,
    effective_state: {
      status: "current",
      stored_version: 1,
      applied_versions: { collector: 1, processor: 1, analytics_api: 1 },
    },
  },
  policy: {
    policy: {
      site_id: "site_demo",
      environment: "production",
      version: 1,
      enabled: true,
      allowed_origins: ["https://demo.test"],
      keys: [{ key_id: "ik_demo", created_at: "" }],
      rate_limit_per_minute: 600,
    },
    effective_state: {
      status: "current",
      stored_version: 1,
      applied_versions: { collector: 1, processor: 1, analytics_api: 1 },
    },
  },
};

describe("site connection status", () => {
  it("requires Page View evidence before saying connected and distinguishes Analytics failure from zero", () => {
    expect(connectionStatus(site(), ready, { kind: "ready", pageViews: 0 }).title).toBe(
      "Waiting for first event",
    );
    const received = connectionStatus(site(), ready, { kind: "ready", pageViews: 2 });
    expect(received.title).toBe("Site has received Page Views");
    expect(received.description).toContain("does not confirm events from the selected environment");
    expect(connectionStatus(site(), ready, { kind: "error", message: "API failed" }).title).toBe(
      "Analytics status unavailable",
    );
  });

  it("prioritizes archived and incomplete setup over runtime and event evidence", () => {
    expect(
      connectionStatus(site({ lifecycle_status: "archived" }), ready, {
        kind: "ready",
        pageViews: 3,
      }).title,
    ).toBe("Archived");
    expect(
      connectionStatus(
        site({ setup_status: "needs_attention", missing_requirements: ["website_url"] }),
        ready,
        { kind: "ready", pageViews: 3 },
      ).title,
    ).toBe("Setup needs attention");
    expect(
      connectionStatus(
        site(),
        {
          ...ready,
          capabilities: {
            ...ready.capabilities,
            effective_state: { ...ready.capabilities.effective_state, status: "pending" },
          },
        },
        { kind: "ready", pageViews: 3 },
      ).title,
    ).toBe("Configuration pending");
    expect(
      connectionStatus(
        site(),
        {
          ...ready,
          policy: {
            ...ready.policy!,
            effective_state: { ...ready.policy!.effective_state, status: "stale" },
          },
        },
        { kind: "ready", pageViews: 3 },
      ).title,
    ).toBe("Configuration out of date");
  });

  it("requires the selected environment's policy to be enabled and ingest-ready", () => {
    const pageViews = { kind: "ready" as const, pageViews: 12 };
    expect(
      connectionStatus(
        site(),
        {
          ...ready,
          policy: { ...ready.policy!, policy: { ...ready.policy!.policy, enabled: false } },
        },
        pageViews,
      ).title,
    ).toBe("Environment ingest policy disabled");
    expect(
      connectionStatus(
        site(),
        {
          ...ready,
          policy: { ...ready.policy!, policy: { ...ready.policy!.policy, allowed_origins: [] } },
        },
        pageViews,
      ).title,
    ).toBe("Environment Allowed Origins missing");
    expect(
      connectionStatus(
        site(),
        { ...ready, policy: { ...ready.policy!, policy: { ...ready.policy!.policy, keys: [] } } },
        pageViews,
      ).title,
    ).toBe("Environment Ingest Key missing");
  });

  it("keeps missing credentials and rejected management credentials distinct", () => {
    expect(
      connectionStatus(
        site(),
        { kind: "environment_unconfigured", message: "Set DASHBOARD_DEFAULT_ENVIRONMENT" },
        { kind: "ready", pageViews: 0 },
      ).title,
    ).toBe("Default environment not configured");
    expect(
      connectionStatus(
        site(),
        { kind: "unconfigured", message: "Set token" },
        { kind: "ready", pageViews: 0 },
      ).title,
    ).toBe("Management credentials not configured");
    expect(
      connectionStatus(
        site(),
        { kind: "unauthorized", message: "Rejected" },
        { kind: "ready", pageViews: 0 },
      ).title,
    ).toBe("Management API authorization failed");
  });

  it("presents a legacy Site without capability configuration as needing attention", () => {
    expect(
      connectionStatus(
        site({ setup_status: "needs_attention", missing_requirements: ["page_views"] }),
        { kind: "missing_capabilities", message: "No capability configuration exists." },
        { kind: "ready", pageViews: 0 },
      ),
    ).toMatchObject({
      title: "Setup needs attention",
      description: "No capability configuration exists.",
    });
  });

  it("refreshes the server rendered status on demand and labels missing requirements", () => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <SiteConnectionStatus
          site={site({ setup_status: "needs_attention", missing_requirements: ["page_views"] })}
          environment="staging"
          configuration={ready}
          analytics={{ kind: "ready", pageViews: 0 }}
        />,
      ),
    );
    expect(container.textContent).toContain("Page Views capability");
    const button = container.querySelector("button");
    act(() => button?.click());
    expect(router.refresh).toHaveBeenCalledOnce();
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("shows separate management and analytics health with links to the existing editors", () => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <SiteConnectionStatus
          site={site()}
          environment="staging"
          configuration={{ kind: "unconfigured", message: "Missing admin token" }}
          analytics={{ kind: "error", message: "Analytics API timed out" }}
        />,
      ),
    );
    expect(container.textContent).toContain("Credentials not configured");
    expect(container.textContent).toContain("Unavailable: Analytics API timed out");
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("states that management API health is unchecked when no Environment is configured", () => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <SiteConnectionStatus
          site={site()}
          environment="not configured"
          configuration={{
            kind: "environment_unconfigured",
            message: "DASHBOARD_DEFAULT_ENVIRONMENT is not configured.",
          }}
          analytics={{ kind: "ready", pageViews: 0 }}
        />,
      ),
    );
    const managementApi = container.querySelector("dt")?.parentElement;
    expect(managementApi?.textContent).toContain("Site Management APINot checked");
    expect(managementApi?.textContent).toContain("default Environment not configured");
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("links incomplete setup requirements to stable editor anchors", () => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const incomplete: ConfigurationLoadResult = {
      ...ready,
      policy: {
        ...ready.policy!,
        policy: { ...ready.policy!.policy, allowed_origins: [], keys: [] },
      },
    };
    act(() =>
      root.render(
        <SiteConnectionStatus
          site={site()}
          environment="staging"
          configuration={incomplete}
          analytics={{ kind: "ready", pageViews: 0 }}
        />,
      ),
    );
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toContain(
      "/dashboard/settings/environments?site_id=site_demo&environment=staging",
    );
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toContain(
      "#ingest-keys",
    );
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("does not show setup-resolution links for an archived Site", () => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const configuration: ConfigurationLoadResult = {
      ...ready,
      policy: {
        ...ready.policy!,
        policy: { ...ready.policy!.policy, allowed_origins: [], keys: [] },
      },
    };

    act(() =>
      root.render(
        <SiteConnectionStatus
          site={site({ lifecycle_status: "archived" })}
          environment="staging"
          configuration={configuration}
          analytics={{ kind: "ready", pageViews: 4 }}
        />,
      ),
    );
    expect(container.textContent).toContain("Archived");
    expect(container.querySelector('[aria-label="Resolve setup status"]')).toBeNull();
    expect(container.querySelector('a[href="#environment-policy"]')).toBeNull();
    expect(container.querySelector('a[href="#ingest-keys"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it.each([
    ["current", "Applied (current)"],
    ["pending", "Waiting to apply"],
    ["stale", "Application out of date"],
  ] as const)("renders the %s capability and policy runtime state clearly", (state, label) => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const configuration: ConfigurationLoadResult = {
      ...ready,
      capabilities: {
        ...ready.capabilities,
        effective_state: { ...ready.capabilities.effective_state, status: state },
      },
      policy: {
        ...ready.policy!,
        effective_state: { ...ready.policy!.effective_state, status: state },
      },
    };

    act(() =>
      root.render(
        <SiteConnectionStatus
          site={site()}
          environment="staging"
          configuration={configuration}
          analytics={{ kind: "ready", pageViews: 4 }}
        />,
      ),
    );
    expect(container.textContent).toContain(`Capabilities: ${label}`);
    expect(container.textContent).toContain(`Ingest policy: ${label}`);
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });
});
