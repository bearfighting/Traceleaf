import { defineConfig, devices } from "@playwright/test";

const websitePort = process.env.WEBSITE_E2E_PORT ?? "3100";

if (!/^[1-9]\d{0,4}$/.test(websitePort) || Number(websitePort) > 65_535) {
  throw new Error("WEBSITE_E2E_PORT must be an integer between 1 and 65535.");
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${websitePort}`,
  },
  webServer: {
    command: `pnpm --filter @traceleaf/website dev --hostname 127.0.0.1 --port ${websitePort}`,
    url: `http://127.0.0.1:${websitePort}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
