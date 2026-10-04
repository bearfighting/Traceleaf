import { cn } from "../../lib/utils";

import type { HTMLAttributes } from "react";

type Tone = "neutral" | "brand" | "success" | "warning";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-canvas text-muted",
    brand: "bg-brand-soft text-brand-dark",
    success: "bg-success-soft text-success-foreground",
    warning: "bg-warning-soft text-warning",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
