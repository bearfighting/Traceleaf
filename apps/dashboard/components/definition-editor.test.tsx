// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefinitionEditor } from "./definition-editor";

const definitions = {
  schema_version: 1 as const,
  site_id: "site_playground",
  revision: 2,
  definition_version: "definitions-v2",
  effective_at: "2026-09-27T00:00:00Z",
  conversions: [
    { id: "purchase", name: "Purchase", event_name: "purchase", active: true, properties: {} },
  ],
  funnels: [],
};

let host: HTMLDivElement;
let root: Root;

function renderEditor() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <DefinitionEditor siteId="site_playground" result={{ kind: "ready", definitions }} />,
    );
  });
}

function labeledInput(labelText: string): HTMLInputElement {
  const label = Array.from(host.querySelectorAll("label")).find((item) =>
    item.textContent?.includes(labelText),
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`Could not find input labeled ${labelText}`);

  return input;
}

function button(text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Could not find button ${text}`);

  return result;
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

describe("DefinitionEditor", () => {
  it("shows an actionable setup error when the Admin credential is missing", () => {
    const html = renderToStaticMarkup(
      <DefinitionEditor
        siteId="site_playground"
        result={{ kind: "unconfigured", message: "Admin token missing" }}
      />,
    );
    expect(html).toContain("Definition management unavailable");
    expect(html).toContain("Admin token missing");
  });

  it("keeps existing definition IDs immutable and renders active state controls", () => {
    const markup = renderToStaticMarkup(
      <DefinitionEditor siteId="site_playground" result={{ kind: "ready", definitions }} />,
    );

    expect(markup).toContain('disabled="" value="purchase"');
    expect(markup).toContain('type="checkbox" checked=""');
    expect(markup).toContain("Stored revision: 2 · definitions-v2");
  });

  it("renders empty-state controls for adding conversions and ordered funnels", () => {
    const html = renderToStaticMarkup(
      <DefinitionEditor siteId="site_playground" result={{ kind: "ready", definitions: null }} />,
    );
    expect(html).toContain("Conversions and funnels");
    expect(html).toContain("Add conversion");
    expect(html).toContain("Funnels");
    expect(html).toContain("Add funnel");
    expect(html).toContain("Save new revision");
  });

  it("locks the editing form while a save is pending", async () => {
    renderEditor();
    changeInput(labeledInput("Name"), "Renamed purchase");

    let finishRequest!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finishRequest = resolve;
          }),
      ),
    );
    act(() => button("Save new revision").click());
    expect(labeledInput("Name").matches(":disabled")).toBe(true);

    await act(async () => {
      finishRequest(
        jsonResponse(200, {
          ...definitions,
          revision: 3,
          definition_version: "definitions-v3",
          conversions: [{ ...definitions.conversions[0], name: "Renamed purchase" }],
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(labeledInput("Name").matches(":disabled")).toBe(false);
    expect(host.textContent).toContain("Saved revision definitions-v3");
  });

  it("displays server validation errors", async () => {
    renderEditor();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          error: {
            message: "Definition validation failed",
            details: [{ path: "conversions[0].event_name", message: "is invalid" }],
          },
        }),
      ),
    );

    act(() => button("Save new revision").click());
    await flushReact();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "conversions[0].event_name: is invalid",
    );
  });

  it("asks before discarding a draft and reloads the latest revision after a conflict", async () => {
    renderEditor();
    changeInput(labeledInput("Name"), "Local draft");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { error: { message: "Revision conflict" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ...definitions,
          revision: 4,
          definition_version: "definitions-v4",
          conversions: [{ ...definitions.conversions[0], name: "Server latest" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    act(() => button("Save new revision").click());
    await flushReact();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Revision conflict");

    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    act(() => button("Reload latest definitions").click());
    expect(confirm).toHaveBeenCalledWith(
      "Reload the latest definitions and discard your unsaved changes?",
    );
    expect(labeledInput("Name").value).toBe("Local draft");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => button("Reload latest definitions").click());
    await flushReact();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(labeledInput("Name").value).toBe("Server latest");
    expect(host.textContent).toContain("Loaded latest definitions at revision definitions-v4");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
