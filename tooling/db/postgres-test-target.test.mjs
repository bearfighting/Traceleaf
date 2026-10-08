import assert from "node:assert/strict";
import test from "node:test";

import { assertPostgresTestAdminTarget } from "./postgres-test-target.mjs";

test("accepts loopback PostgreSQL maintenance targets and controlled test database names", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    assert.doesNotThrow(() =>
      assertPostgresTestAdminTarget(
        `postgres://test:secret@${host}:55432/postgres`,
        "analytics_test_collector_run1",
      ),
    );
  }
});

test("rejects malformed URLs without echoing credentials", () => {
  const secretUrl = "not a url with secret-password";
  assert.throws(
    () => assertPostgresTestAdminTarget(secretUrl, "analytics_test_collector_run1"),
    (error) => error.message.includes("valid PostgreSQL URL") && !error.message.includes(secretUrl),
  );
});

test("rejects non-PostgreSQL protocols, non-loopback hosts, and non-test databases", () => {
  assert.throws(
    () => assertPostgresTestAdminTarget("https://localhost/postgres"),
    /use PostgreSQL/,
  );
  assert.throws(
    () => assertPostgresTestAdminTarget("postgres://user:secret@example.com/postgres"),
    (error) => error.message.includes("loopback") && !error.message.includes("secret"),
  );
  assert.throws(
    () => assertPostgresTestAdminTarget("postgres://localhost/postgres", "analytics"),
    /invalid PostgreSQL test database name/,
  );
});
