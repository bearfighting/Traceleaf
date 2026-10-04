import React from "react";

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TableHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border-brand bg-brand text-white hover:bg-brand-dark",
  secondary: "border-line bg-surface text-ink hover:bg-canvas",
  ghost: "border-transparent bg-transparent text-muted hover:bg-canvas hover:text-ink",
  danger: "border-red-700 bg-red-700 text-white hover:bg-red-800",
};

export function Button({
  className = "",
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
      type={type}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-sm placeholder:text-muted ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-sm ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface p-5 shadow-sm md:p-6 ${className}`}
      {...props}
    />
  );
}

export function Badge({
  className = "",
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "brand" | "success" | "warning" }) {
  const tones = {
    neutral: "bg-canvas text-muted",
    brand: "bg-brand-soft text-brand-dark",
    success: "bg-success-soft text-green-800",
    warning: "bg-warning-soft text-amber-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
      {...props}
    />
  );
}

export function Alert({
  className = "",
  tone = "info",
  role,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "warning" | "danger" }) {
  const tones = {
    info: "border-brand/20 bg-brand-soft text-brand-dark",
    success: "border-green-700/20 bg-success-soft text-green-800",
    warning: "border-amber-700/20 bg-warning-soft text-amber-900",
    danger: "border-red-700/20 bg-danger-soft text-red-900",
  };

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]} ${className}`}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      {...props}
    />
  );
}

export function Table({
  className = "",
  tabIndex = 0,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={`w-full border-collapse text-left text-sm ${className}`}
      tabIndex={tabIndex}
      {...props}
    />
  );
}
