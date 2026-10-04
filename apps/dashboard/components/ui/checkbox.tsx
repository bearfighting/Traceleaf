import { cn } from "../../lib/utils";

import type { InputHTMLAttributes } from "react";

export function Checkbox({
  className,
  type: _type,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 rounded border-line accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className,
      )}
      {...props}
    />
  );
}
