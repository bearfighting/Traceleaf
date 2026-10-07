// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ConfigurationEditor, ConfigurationErrorFeedback } from "./configuration-editor";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

const result = {
  kind: "ready" as const,
  capabilities: {
    configuration: {
      schema_version: 1 as const,
      site_id: "site-one",
      version: 3,
      updated_at: "2026-09-26T00:00:00Z",
      capabilities: {
        page_views: { enabled: true, settings: {} },
        browser_context: { enabled: true, settings: {} },
        anonymous_visitors: { enabled: true, settings: {} },
        sessions: { enabled: true, settings: {} },
        dimensions: { enabled: true, settings: {} },
        custom_events: { enabled: true, settings: {} },
        web_vitals: { enabled: true, settings: {} },
        conversions: { enabled: true, settings: {} },
        funnels: { enabled: true, settings: {} },
        geo: { enabled: true, settings: {} },
      },
      consent_policy: "required" as const,
      privacy_constraints: ["no_ip_persistence", "no_fingerprinting", "consent_required"] as [
        "no_ip_persistence",
        "no_fingerprinting",
        "consent_required",
      ],
    },
    effective_state: {
      status: "pending" as const,
      stored_version: 3,
      applied_versions: { collector: 3, processor: null, analytics_api: 2 },
    },
  },
  policy: null,
};

describe("ConfigurationEditor", () => {
  it("renders privacy requirements, dependencies, runtime versions, and empty policy state", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationEditor
        siteId="site-one"
        environment="production"
        result={result}
        section="capabilities"
      />,
    );
    expect(markup).toContain("Consent required.");
    expect(markup).toContain("Requires Anonymous Visitors.");
    expect(markup).toContain("Runtime status: pending");
    expect(markup).toMatch(
      /<div class="effective-state effective-pending" role="status" aria-atomic="true">/,
    );
    expect(markup).toContain("processor: not reported");
    expect(markup).not.toContain("Create environment policy");
    expect(markup).not.toContain("Create Ingest Key");
  });

  it("updates the live runtime status after refreshed props without remounting the editor", () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const props = {
      siteId: "site-one",
      environment: "production",
      section: "capabilities" as const,
    };

    act(() => root?.render(<ConfigurationEditor {...props} result={result} />));
    expect(container.textContent).toContain("Runtime status: pending");

    const refreshed = {
      ...result,
      capabilities: {
        ...result.capabilities,
        effective_state: { ...result.capabilities.effective_state, status: "current" as const },
      },
    };
    act(() => root?.render(<ConfigurationEditor {...props} result={refreshed} />));

    expect(container.textContent).toContain("Runtime status: current");
  });

  it("shows the runtime state returned by a capability save for its new version", async () => {
    const saved = {
      ...result.capabilities,
      configuration: { ...result.capabilities.configuration, version: 4 },
      effective_state: {
        status: "stale" as const,
        stored_version: 4,
        applied_versions: { collector: 3, processor: null, analytics_api: 2 },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(saved));
    vi.stubGlobal("fetch", fetchMock);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <ConfigurationEditor
          siteId="site-one"
          environment="production"
          result={result}
          section="capabilities"
        />,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1)));
    const saveButton = [...(container.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Save capabilities"),
    );

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Runtime status: stale");
    expect(container.textContent).toContain("Stored version 4");
  });

  it("renders environment ingestion state from the stored policy", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationEditor
        siteId="site-one"
        environment="production"
        result={{
          ...result,
          policy: {
            policy: {
              site_id: "site-one",
              environment: "production",
              version: 4,
              enabled: false,
              allowed_origins: ["https://example.test"],
              keys: [],
              rate_limit_per_minute: 600,
            },
            effective_state: {
              status: "pending",
              stored_version: 4,
              applied_versions: { collector: null, processor: null, analytics_api: null },
            },
          },
        }}
        section="environments"
      />,
    );

    expect(markup).toContain('aria-label="Enable environment ingestion"');
    expect(markup).toContain("When disabled, the Collector rejects events.");
    const policyToggle = markup.match(
      /<input type="checkbox"[^>]*aria-label="Enable environment ingestion"[^>]*\/>/,
    )?.[0];
    expect(policyToggle).toBeDefined();
    expect(policyToggle).not.toContain('checked=""');
  });

  it("renders a reload action with version-conflict feedback", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationErrorFeedback
        error="Configuration changed or already exists. Reload to review the latest configuration."
        onReload={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Configuration changed or already exists.");
    expect(markup).toContain("Reload latest configuration");
  });

  it("does not show a reload action for ordinary validation errors", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationErrorFeedback
        error="Configuration failed validation. /allowed_origins: Invalid origin."
        onReload={() => {}}
      />,
    );

    expect(markup).toContain("Configuration failed validation.");
    expect(markup).not.toContain("Reload latest configuration");
  });

  it("renders server configuration failures without configuration controls", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationEditor
        siteId="site-one"
        environment="production"
        result={{ kind: "unconfigured", message: "DASHBOARD_CONFIG_ADMIN_TOKEN is missing" }}
      />,
    );
    expect(markup).toContain("DASHBOARD_CONFIG_ADMIN_TOKEN is missing");
    expect(markup).not.toContain("Save capabilities");
  });
});
