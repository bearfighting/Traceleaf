import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const cacheInputs = [
  "Cargo.toml",
  "Cargo.lock",
  "crates/configuration-runtime/Cargo.toml",
  "services/collector/Cargo.toml",
  "services/processor/Cargo.toml",
  "services/analytics-api/Cargo.toml",
  "tools/db-migrator/Cargo.toml",
  "rust-toolchain.toml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "compose.e2e.yaml",
  "docker/collector.Dockerfile",
  "docker/processor.Dockerfile",
  "docker/analytics-api.Dockerfile",
  "docker/dashboard.Dockerfile",
];

export function prepareE2ECaches(root, scope) {
  const hash = createHash("sha256").update(path.resolve(root));
  for (const relativePath of cacheInputs) {
    hash.update(relativePath);
    hash.update(readFileSync(path.join(root, relativePath)));
  }
  const prefix = `web-analytics-e2e-${hash.digest("hex").slice(0, 12)}`;
  process.env.E2E_CACHE_PREFIX = prefix;
  process.env.E2E_CACHE_SCOPE = scope;

  for (const suffix of [
    "collector_target",
    "processor_target",
    "analytics_api_target",
    "cargo_home",
    "root_node_modules",
    "dashboard_node_modules",
    `${scope}_dashboard_next`,
  ]) {
    execFileSync("docker", ["volume", "create", `${prefix}_${suffix}`], {
      cwd: root,
      stdio: "ignore",
    });
  }
}
