import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilityConfigurationSeedSql,
  IMPLEMENTED_CAPABILITY_IDS,
} from "./capability-seed.mjs";

test("capability seed uses all and only implemented manifest capabilities", () => {
  const sql = buildCapabilityConfigurationSeedSql(["site_example"]);

  assert.equal(IMPLEMENTED_CAPABILITY_IDS.length, 10);
  for (const capabilityId of IMPLEMENTED_CAPABILITY_IDS) {
    assert.match(sql, new RegExp(`\\('${capabilityId}'\\)`));
  }
  assert.match(sql, /ON CONFLICT \(site_id\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT \(site_id, capability_id\) DO NOTHING/);
});

test("capability seed safely quotes and deduplicates site IDs", () => {
  const sql = buildCapabilityConfigurationSeedSql(["site_example", "site_example", "test'site"]);

  assert.match(sql, /\('test''site'\)/);
  assert.equal((sql.match(/site_example/g) ?? []).length, 2);
});

test("capability seed rejects missing or invalid site IDs", () => {
  assert.throws(() => buildCapabilityConfigurationSeedSql([]), /At least one site ID/);
  assert.throws(() => buildCapabilityConfigurationSeedSql([""]), /between 1 and 64 characters/);
});
