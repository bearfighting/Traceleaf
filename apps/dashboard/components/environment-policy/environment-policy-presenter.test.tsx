// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ConfigurationEditor } from "../configuration-editor";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const capabilities = {
  configuration: {
    schema_version: 1 as const,
    site_id: "site-one",
    version: 3,
    updated_at: "2026-09-26T00:00:00Z",
    capabilities: {},
    consent_policy: "required" as const,
    privacy_constraints: ["no_ip_persistence", "no_fingerprinting", "consent_required"] as [
      "no_ip_persistence",
      "no_fingerprinting",
      "consent_required",
    ],
  },
  effective_state: {
    status: "current" as const,
    stored_version: 3,
    applied_versions: { collector: 3, processor: 3, analytics_api: 3 },
  },
};

function render(policy: null | object = null) {
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
        result={{ kind: "ready", capabilities, policy } as never}
        section="environments"
      />,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  router.refresh.mockReset();
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("EnvironmentPolicyPresenter flow", () => {
  it("starts with the no-policy defaults and leaves controls disabled until hydrated", () => {
    render();
    expect(container?.textContent).toContain("No environment policy exists yet");
    expect((container?.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(container?.querySelector("textarea")?.value).toBe("");
    expect((container?.querySelector('input[type="number"]') as HTMLInputElement).value).toBe(
      "600",
    );
    expect(container?.querySelector("button")?.disabled).toBe(true);
  });

  it("saves a new policy, reports success, and refreshes the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            policy: {
              site_id: "site-one",
              environment: "production",
              version: 1,
              enabled: false,
              allowed_origins: ["https://example.test"],
              keys: [],
              rate_limit_per_minute: 600,
            },
            effective_state: {
              status: "pending",
              stored_version: 1,
              applied_versions: { collector: null, processor: null, analytics_api: null },
            },
          },
          { status: 201 },
        ),
      ),
    );
    render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const toggle = container?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      toggle.click();
    });
    const button = container?.querySelector("button");
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain(
      "Website access settings saved. Ingestion is disabled.",
    );
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("disables the form while a save request is pending", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingResponse));
    render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      container?.querySelector("button")?.click();
    });
    expect(container?.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(
      [
        ...((container?.querySelectorAll("button, input, textarea") ??
          []) as NodeListOf<HTMLElement>),
      ].every((control) => (control as HTMLButtonElement).disabled),
    ).toBe(true);

    await act(async () => {
      resolveResponse?.(
        Response.json(
          {
            policy: {
              site_id: "site-one",
              environment: "production",
              version: 1,
              enabled: true,
              allowed_origins: [],
              keys: [],
              rate_limit_per_minute: 600,
            },
            effective_state: {
              status: "pending",
              stored_version: 1,
              applied_versions: { collector: null, processor: null, analytics_api: null },
            },
          },
          { status: 201 },
        ),
      );
      await pendingResponse;
    });

    expect(container?.textContent).toContain(
      "Website access settings saved. Ingestion is enabled.",
    );
    expect(container?.querySelector("button")?.disabled).toBe(false);
  });

  it("keeps conflict errors visible with the reload action", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "Configuration changed or already exists." } },
            { status: 409 },
          ),
        ),
    );
    render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      container?.querySelector("button")?.click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Configuration changed or already exists.");
    expect(container?.textContent).toContain("Reload latest configuration");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
