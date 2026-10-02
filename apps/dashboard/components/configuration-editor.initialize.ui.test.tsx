// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ConfigurationEditor } from "./configuration-editor";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderMissingConfiguration() {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ConfigurationEditor
        siteId="legacy/site"
        environment="production"
        result={{ kind: "missing_capabilities", message: "No capability configuration exists." }}
      />,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  router.refresh.mockReset();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("missing capability configuration recovery", () => {
  it("creates default capabilities using a create-only precondition and refreshes Settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    renderMissingConfiguration();

    const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) =>
      candidate.textContent?.includes("Initialize capabilities"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/legacy%2Fsite/capabilities",
      expect.objectContaining({
        method: "POST",
        headers: { "If-None-Match": "*" },
        cache: "no-store",
      }),
    );
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("shows initialization errors without pretending the configuration was created", async () => {
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
    renderMissingConfiguration();
    const button = container?.querySelector("button");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Configuration changed or already exists.");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
