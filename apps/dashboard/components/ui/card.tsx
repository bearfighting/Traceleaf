import { cn } from "../../lib/utils";

import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-line bg-surface p-5 shadow-sm md:p-6", className)}
      {...props}
    />
  );
}
