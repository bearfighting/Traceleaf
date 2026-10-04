"use client";

import { useEffect, type ReactNode } from "react";

import { Button } from "./button";

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    document.getElementById("alert-dialog-cancel")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="alertdialog"] button:not(:disabled), [role="alertdialog"] [href], [role="alertdialog"] input:not(:disabled)',
          ),
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        aria-describedby="alert-dialog-description"
        aria-labelledby="alert-dialog-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-xl"
        role="alertdialog"
      >
        <h2 className="text-lg font-semibold" id="alert-dialog-title">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted" id="alert-dialog-description">
          {description}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            className=""
            disabled={busy}
            id="alert-dialog-cancel"
            onClick={onCancel}
            variant="secondary"
          >
            {cancelLabel}
          </Button>
          <Button disabled={busy} onClick={onConfirm} variant="destructive">
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
