import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../styles.css";

export const metadata: Metadata = {
  title: {
    default: "Traceleaf Dashboard",
    template: "%s | Traceleaf Dashboard",
  },
  description: "Explore website analytics for your sites with Traceleaf.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
