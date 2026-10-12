import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@web-analytics/analytics-core": new URL("../analytics-core/src/index.ts", import.meta.url)
        .pathname,
      "@web-analytics/observer-core": new URL("../observer-core/src/index.ts", import.meta.url)
        .pathname,
      "@web-analytics/protocol-ts": new URL("../protocol-ts/src/index.ts", import.meta.url)
        .pathname,
      "@web-analytics/transport": new URL("../transport/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
