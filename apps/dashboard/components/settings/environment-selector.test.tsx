// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { EnvironmentSelector } from "./environment-selector";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(value: string) {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() =>
    root?.render(<EnvironmentSelector value={value} siteId="site_alpha" route="ingest-keys" />),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  router.push.mockReset();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("EnvironmentSelector", () => {
  it("syncs the input when browser navigation restores another Environment", () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    render("production");
    const input = container?.querySelector("input");
    expect(input?.value).toBe("production");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "preview");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    render("preview");
    const previewInput = container?.querySelector("input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(previewInput, "staging");
      previewInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    render("production");

    expect(container?.querySelector("input")?.value).toBe("production");
  });

  it("submits the selected Environment to the current Settings route", () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    render("preview");
    const form = container?.querySelector("form");
    expect(form).toBeDefined();
    act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(router.push).toHaveBeenCalledWith(
      "/dashboard/settings/ingest-keys?site_id=site_alpha&environment=preview",
    );
  });
});
