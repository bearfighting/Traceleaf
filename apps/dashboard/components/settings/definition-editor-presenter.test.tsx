// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DefinitionEditorPresenter,
  type DefinitionEditorPresenterProps,
} from "./definition-editor";

const definition = {
  schema_version: 1 as const,
  site_id: "site_playground",
  revision: 3,
  definition_version: "definitions-v3",
  effective_at: "2026-09-27T00:00:00Z",
  conversions: [
    { id: "purchase", name: "Purchase", event_name: "purchase", active: true, properties: {} },
  ],
  funnels: [
    {
      id: "checkout",
      name: "Checkout",
      active: true,
      steps: [
        { event_name: "cart", properties: {} },
        { event_name: "purchase", properties: {} },
      ],
    },
  ],
};

const actions = {
  updateConversion: vi.fn(),
  addConversion: vi.fn(),
  updateFunnel: vi.fn(),
  addFunnel: vi.fn(),
  updateFunnelStep: vi.fn(),
  addFunnelStep: vi.fn(),
  removeFunnelStep: vi.fn(),
};

function props(
  overrides: Partial<DefinitionEditorPresenterProps> = {},
): DefinitionEditorPresenterProps {
  return {
    conversions: definition.conversions,
    funnels: definition.funnels,
    baseline: definition,
    revision: definition.revision,
    definitionVersion: definition.definition_version,
    busy: false,
    error: "",
    message: "",
    versionConflict: false,
    confirmReload: false,
    onConfirmationChange: vi.fn(),
    onSave: vi.fn().mockResolvedValue(""),
    onReload: vi.fn().mockResolvedValue(undefined),
    actions,
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderPresenter(presenterProps: DefinitionEditorPresenterProps) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<DefinitionEditorPresenter {...presenterProps} />));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Could not find button ${label}`);

  return found;
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe("DefinitionEditorPresenter", () => {
  it("dispatches edits and funnel actions through the supplied callbacks", () => {
    renderPresenter(props());

    act(() => button("Add funnel").click());
    act(() => button("Add step").click());

    expect(actions.addFunnel).toHaveBeenCalledOnce();
    expect(actions.addFunnelStep).toHaveBeenCalledWith(0);
  });

  it("shows pending, error, and success state from props", () => {
    renderPresenter(props({ busy: true, error: "Could not save", message: "Saved revision v3" }));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Saved revision v3");
    expect(button("Saving…").disabled).toBe(true);
    expect(host.querySelector("fieldset.definition-groups")?.hasAttribute("disabled")).toBe(true);
  });

  it("locks persisted IDs and preserves ordered funnel steps", () => {
    renderPresenter(props());

    const idInputs = Array.from(host.querySelectorAll("label"))
      .filter((label) => label.textContent?.trim().startsWith("ID"))
      .map((label) => label.querySelector("input"))
      .filter((input): input is HTMLInputElement => input !== null);
    expect(idInputs).toHaveLength(2);
    expect(idInputs.every((input) => input.disabled)).toBe(true);
    const stepLabels = Array.from(host.querySelectorAll(".definition-step")).map(
      (step) => step.querySelector(":scope > legend")?.textContent,
    );
    expect(stepLabels).toEqual(["Step 1", "Step 2"]);
    const eventNames = Array.from(
      host.querySelectorAll<HTMLInputElement>(".definition-step input"),
    ).map((input) => input.value);
    expect(eventNames).toEqual(["cart", "purchase"]);
  });
});
