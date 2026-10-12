import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Traceleaf — self-hosted web analytics",
    template: "%s | Traceleaf",
  },
  description:
    "Self-hosted web analytics for developers who want control over their data and infrastructure.",
};

const themeBootstrap = `(() => {
  try {
    const saved = localStorage.getItem("traceleaf-theme");
    const theme = saved === "light" || saved === "dark" ? saved : "system";
    const resolved = theme === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = theme;
  } catch {}
})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
