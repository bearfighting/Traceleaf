import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, statSync } from "node:fs";
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
  "compose.yaml",
  "compose.backend.yaml",
  "compose.dev.yaml",
  "docker/rust-workspace.Dockerfile",
  "docker/dashboard.Dockerfile",
  "docker/dev-seed.Dockerfile",
  "db/seeds/development/dev-seed.mjs",
  "tooling/contracts/capability-seed.mjs",
];

export function prepareE2ECaches(root, scope) {
  prepareNodeWorkspaceDirectories(root);

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

  // Initialize the shared Cargo volume once before Compose mounts it into multiple Rust services.
  // Docker otherwise races while copying the Rust image symlinks into the new volume.
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--volume",
      `${prefix}_cargo_home:/usr/local/cargo`,
      "rust:1.98.1-bookworm",
      "true",
    ],
    { cwd: root, stdio: "ignore" },
  );

  initializeNodeOwnedVolume(root, `${prefix}_${scope}_dashboard_next`);
  return prefix;
}

function prepareNodeWorkspaceDirectories(root) {
  // Node images run as UID 1000. On GitHub-hosted runners the checkout is owned
  // by another UID, so grant the runner's group write access to the paths in
  // which Vite, tsup, and Next.js create generated files. Compose adds that
  // group to the Node containers without changing their UID or package cache.
  if ((process.getuid?.() ?? 1000) === 1000) return;

  const writableDirectories = [
    "packages",
    "packages/analytics-browser",
    "packages/analytics-core",
    "packages/observer-core",
    "packages/playground-support",
    "packages/protocol-ts",
    "packages/transport",
    "apps/dashboard",
  ];
  for (const relativePath of writableDirectories) {
    const directory = path.join(root, relativePath);
    chmodSync(directory, statSync(directory).mode | 0o020);
  }

  const nextEnvironmentTypes = path.join(root, "apps/dashboard/next-env.d.ts");
  chmodSync(nextEnvironmentTypes, statSync(nextEnvironmentTypes).mode | 0o020);
}

export function initializeNodeOwnedVolume(root, volume) {
  // Dashboard images run as node, but a pre-created named volume starts with
  // a root-owned directory and hides the image's writable .next path.
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--volume",
      `${volume}:/cache`,
      "node:26.10.0-bookworm-slim",
      "chown",
      "1000:1000",
      "/cache",
    ],
    { cwd: root, stdio: "ignore" },
  );
}
