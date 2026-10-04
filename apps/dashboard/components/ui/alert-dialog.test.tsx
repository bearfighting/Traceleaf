// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlertDialog } from "./alert-dialog";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("AlertDialog", () => {
  it("moves focus into the modal, traps tab navigation, and cancels on Escape", () => {
    const onCancel = vi.fn();
    act(() => {
      root.render(
        <AlertDialog
          open
          title="Confirm"
          description="Discard this draft?"
          confirmLabel="Discard"
          onCancel={onCancel}
          onConfirm={() => {}}
        />,
      );
    });

    const cancel = host.querySelector<HTMLButtonElement>("#alert-dialog-cancel");
    const confirm = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Discard",
    );
    expect(document.activeElement).toBe(cancel);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    });
    expect(document.activeElement).toBe(confirm);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
