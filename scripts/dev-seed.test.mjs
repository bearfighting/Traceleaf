import assert from "node:assert/strict";
import test from "node:test";

import { buildDevelopmentSiteSeedSql, DEV_SEED_SITE_ID } from "./dev-seed.mjs";

test("development seed creates the fixed local Site before its configuration", () => {
  const sql = buildDevelopmentSiteSeedSql({
    origins: "http://localhost:3000,http://localhost:3101",
    ingestKey: "local-example-key",
  });

  assert.equal(DEV_SEED_SITE_ID, "site_example");
  assert.match(sql, /INSERT INTO site_registry \(site_id, display_name, website_url\)/);
  assert.match(sql, /'site_example', 'Local Example Site', 'http:\/\/localhost:3000'/);
  assert.match(sql, /ON CONFLICT \(site_id\) DO NOTHING/);
  assert.match(sql, /INSERT INTO site_capability_configurations/);
  assert.match(sql, /INSERT INTO site_capability_activation_windows/);
  assert.match(sql, /INSERT INTO site_environment_policies/);
  assert.match(sql, /ON CONFLICT \(site_id, environment\) DO NOTHING/);
  assert.doesNotMatch(sql, /local-example-key/);
  assert.match(sql, /sha256_digest/);
});

test("development seed validates every configured Origin", () => {
  for (const origins of ["", "http://localhost:3000/path", "file:///tmp"]) {
    assert.throws(() => buildDevelopmentSiteSeedSql({ origins, ingestKey: "local-example-key" }));
  }
});
