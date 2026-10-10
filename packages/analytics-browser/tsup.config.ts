import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["ulid", "web-vitals"],
});
