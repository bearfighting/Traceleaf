import { cn } from "../../lib/utils";

import type { HTMLAttributes } from "react";

type Tone = "info" | "success" | "warning" | "danger";

export function Alert({
  className,
  tone = "info",
  role,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  const tones: Record<Tone, string> = {
    info: "border-brand/20 bg-brand-soft text-brand-dark",
    success: "border-success-foreground/20 bg-success-soft text-success-foreground",
    warning: "border-warning/20 bg-warning-soft text-warning",
    danger: "border-danger-foreground/20 bg-danger-soft text-danger-foreground",
  };

  return (
    <div
      className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], className)}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      {...props}
    />
  );
}
