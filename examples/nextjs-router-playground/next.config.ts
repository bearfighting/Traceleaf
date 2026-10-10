import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@traceleaf/browser",
    "@web-analytics/analytics-core",
    "@web-analytics/observer-core",
    "@web-analytics/playground-support",
    "@web-analytics/protocol-ts",
  ],
};

export default nextConfig;
