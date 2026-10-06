import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSeedComposeArgs,
  buildProfileUpComposeArgs,
  buildUpComposeArgs,
  parseSeedInitArgs,
  runDevelopmentMode,
} from "./dev-compose.mjs";
import { nativeComposeArgs, nativeDatabaseUrl, nativeServiceNames } from "./native-rust.mjs";

const scriptPath = fileURLToPath(new URL("./dev-compose.mjs", import.meta.url));

test("development startup defaults to no seed and accepts both explicit seed spellings", () => {
  assert.deepEqual(parseSeedInitArgs([]), { seedInit: false, rustRuntime: "container" });
  assert.deepEqual(parseSeedInitArgs(["--seed-init"]), {
    seedInit: true,
    rustRuntime: "container",
  });
  assert.deepEqual(parseSeedInitArgs(["--seed"]), { seedInit: true, rustRuntime: "container" });
  assert.deepEqual(parseSeedInitArgs(["--rust-runtime=native"]), {
    seedInit: false,
    rustRuntime: "native",
  });
});

test("development startup rejects duplicate and unknown arguments", () => {
  assert.throws(() => parseSeedInitArgs(["--seed", "--seed-init"]), /only one/);
  assert.throws(() => parseSeedInitArgs(["--mystery"]), /Unknown/);
  assert.throws(() => parseSeedInitArgs(["--rust-runtime", "vm"]), /Unknown Rust runtime/);
  assert.throws(() => parseSeedInitArgs(["--rust-runtime"]), /requires container or native/);
  assert.throws(
    () => parseSeedInitArgs(["--rust-runtime=native", "--rust-runtime=container"]),
    /only once/,
  );
});

test("native Rust mode selects only the services needed by each development profile", () => {
  assert.deepEqual(nativeServiceNames("backend"), ["collector"]);
  assert.deepEqual(nativeServiceNames("processing"), ["collector", "processor", "analytics-api"]);
  assert.ok(nativeComposeArgs("processing").includes("--no-deps"));
  assert.equal(nativeComposeArgs("processing").includes("dashboard"), false);
  assert.ok(nativeComposeArgs("full").includes("dashboard"));
});

test("native Rust mode maps the Compose postgres alias to localhost", () => {
  const url = nativeDatabaseUrl({
    services: {
      collector: { environment: { DATABASE_URL: "postgres://user:pass@postgres:5432/analytics" } },
    },
  });
  assert.equal(url, "postgres://user:pass@127.0.0.1:5432/analytics");
  assert.equal(nativeDatabaseUrl({ services: { collector: { environment: {} } } }), undefined);
});

test("development Compose CLI executes argument validation when run directly", () => {
  const result = spawnSync(process.execPath, [path.resolve(scriptPath), "full", "--mystery"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown development Compose argument/);
});

test("default up commands do not activate the dev-seed profile", () => {
  for (const mode of ["full", "backend", "processing"]) {
    const args = buildUpComposeArgs(mode);
    assert.equal(args.includes("dev-seed"), false);
    assert.equal(args.at(-3), "up");
  }
});

test("default startup wrapper validates Compose and launches up without invoking seed", () => {
  const synchronousCommands = [];
  const launchedCommands = [];
  const env = { COMPOSE_PROJECT_NAME: "dev-compose-unit-test" };

  runDevelopmentMode("full", [], {
    spawnSyncImpl: (command, args, options) => {
      synchronousCommands.push({ command, args, options });
      return { status: 0 };
    },
    spawnImpl: (command, args, options) => {
      launchedCommands.push({ command, args, options });
      return new EventEmitter();
    },
    env,
  });

  assert.deepEqual(
    synchronousCommands.map(({ command, args }) => [command, args]),
    [["docker", ["compose", "version"]]],
  );
  assert.equal(launchedCommands.length, 1);
  assert.equal(launchedCommands[0].command, "docker");
  assert.equal(launchedCommands[0].args[0], "compose");
  assert.equal(launchedCommands[0].args.at(-3), "up");
  assert.equal(launchedCommands[0].args.includes("dev-seed"), false);
  assert.equal(launchedCommands[0].options.env, env);
});

test("explicit seeding runs the seed service with its storage dependencies first", () => {
  const args = buildSeedComposeArgs();
  assert.deepEqual(args.slice(-5), ["storage", "run", "--build", "--rm", "dev-seed"]);
});

test("docker dev backend can omit the development overlay for the mock-only playground", () => {
  const args = buildProfileUpComposeArgs(["playground-next"], { developmentOverlay: false });
  assert.deepEqual(args.slice(0, 2), ["-f", "compose.yaml"]);
  assert.equal(args.includes("compose.dev.yaml"), false);
  assert.equal(args.includes("dev-seed"), false);
});
