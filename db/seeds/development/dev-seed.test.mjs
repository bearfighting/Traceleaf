import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildDevelopmentSiteSeedSql, DEV_SEED_SITE_ID, requiredEnvironment } from "./dev-seed.mjs";

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
  assert.match(sql, /'allowed_origins', to_jsonb\(origins\)/);
  assert.match(sql, /'rate_limit_per_minute', 600/);
  assert.match(sql, /'enabled', TRUE/);
  assert.match(sql, /ARRAY\['http:\/\/localhost:3000', 'http:\/\/localhost:3101'\]/);
  assert.doesNotMatch(
    sql,
    /INSERT INTO (raw_events|site_definition_revisions|page_view_daily|session_daily)/,
  );
  assert.doesNotMatch(sql, /local-example-key/);
  assert.match(sql, /sha256_digest/);
  const digest = createHash("sha256").update("local-example-key").digest("hex");
  assert.match(sql, new RegExp(digest));
  assert.match(sql, new RegExp(`ik_${digest.slice(0, 16)}`));
});

test("development seed requires a non-blank explicit ingest key", () => {
  assert.equal(requiredEnvironment("DEV_SEED_INGEST_KEY", { DEV_SEED_INGEST_KEY: " key " }), "key");
  for (const value of [undefined, "", "  \t"]) {
    assert.throws(
      () => requiredEnvironment("DEV_SEED_INGEST_KEY", { DEV_SEED_INGEST_KEY: value }),
      /DEV_SEED_INGEST_KEY must be set/,
    );
  }
});

test("development seed validates every configured Origin", () => {
  for (const origins of ["", "http://localhost:3000/path", "file:///tmp"]) {
    assert.throws(() => buildDevelopmentSiteSeedSql({ origins, ingestKey: "local-example-key" }));
  }
});
