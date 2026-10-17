import { Suspense } from "react";

import { NavigationControls } from "./components/navigation-controls";
import { NavigationDebugPanel } from "./components/navigation-debug-panel";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Next.js Router Playground",
  description: "A minimal Next.js App Router test target for Traceleaf navigation behavior.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Suspense fallback={<p>Loading navigation playground...</p>}>
          <NavigationControls />
          <NavigationDebugPanel />
        </Suspense>
      </body>
    </html>
  );
}
