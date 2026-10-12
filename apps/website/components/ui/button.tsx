import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "quiet";
type Size = "default" | "large";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  quiet: "text-muted-foreground hover:bg-muted hover:text-foreground",
};

const sizes: Record<Size, string> = {
  default: "min-h-10 px-4 py-2 text-sm",
  large: "min-h-12 px-5 py-3 text-base",
};

const baseClass =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Button({
  children,
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button className={cn(baseClass, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  className,
  href,
  variant = "primary",
  size = "default",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  href: string;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <Link
      className={cn(baseClass, variants[variant], sizes[size], className)}
      href={href}
      {...props}
    >
      {children}
    </Link>
  );
}
