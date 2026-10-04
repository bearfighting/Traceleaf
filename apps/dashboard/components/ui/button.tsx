import { cn } from "../../lib/utils";

import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "secondary" | "ghost" | "destructive" | "link";

const variants: Record<Variant, string> = {
  default: "border-brand bg-brand text-white hover:bg-brand-dark",
  secondary: "border-line bg-surface text-ink hover:bg-canvas",
  ghost: "border-transparent bg-transparent text-muted hover:bg-canvas hover:text-ink",
  destructive:
    "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
  link: "border-transparent bg-transparent text-brand underline-offset-4 hover:underline",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | "primary" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  const resolvedVariant =
    variant === "primary" ? "default" : variant === "danger" ? "destructive" : variant;
  const sizeClass =
    size === "sm"
      ? "min-h-8 px-3 py-1.5"
      : size === "lg"
        ? "min-h-12 px-6"
        : size === "icon"
          ? "size-10 p-0"
          : "min-h-10 px-4 py-2";

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        sizeClass,
        variants[resolvedVariant],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
