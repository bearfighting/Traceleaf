import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDevArgs,
  parseDockerArgs,
  RouterArgumentError,
  ROUTER_TARGETS,
} from "./router-targets.mjs";

test("defaults dev to Next and preserves passthrough arguments", () => {
  assert.equal(parseDevArgs([]).router, "next");
  assert.deepEqual(parseDevArgs(["--router", "react", "--host", "127.0.0.1"]).passthrough, [
    "--host",
    "127.0.0.1",
  ]);
});

test("resolves every allowed Router target", () => {
  for (const router of Object.keys(ROUTER_TARGETS)) {
    assert.equal(parseDevArgs(["--router", router]).router, router);
  }
});

test("rejects invalid or duplicate Router arguments", () => {
  for (const args of [
    ["--router", "invalid"],
    ["--router"],
    ["--router", "react", "--router", "next"],
  ]) {
    assert.throws(() => parseDevArgs(args), RouterArgumentError);
  }
});

test("parses docker backend selection and rejects unknown options", () => {
  assert.equal(parseDockerArgs(["--router", "tanstack", "--with-backend"]).withBackend, true);
  assert.equal(parseDockerArgs(["--with-backend", "--seed-init"]).seedInit, true);
  assert.equal(parseDockerArgs(["--with-backend", "--seed"]).seedInit, true);
  assert.throws(() => parseDockerArgs(["--unknown"]), RouterArgumentError);
  assert.throws(() => parseDockerArgs(["--seed-init"]), /requires --with-backend/);
  assert.throws(
    () => parseDockerArgs(["--with-backend", "--seed", "--seed-init"]),
    /may only be specified once/,
  );
  assert.throws(() => parseDevArgs(["--with-backend"]), RouterArgumentError);
});
