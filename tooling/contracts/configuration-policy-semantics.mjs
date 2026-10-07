import path from "node:path";

export async function validateConfigurationPolicySemantics({
  contractRoot,
  readJson,
  manifest,
  fail,
  pass,
}) {
  const policySemanticCases = await readJson(
    path.join(contractRoot, "fixtures/policy-semantic-cases.json"),
  );
  for (const testCase of policySemanticCases.cases) {
    const keys = new Set();
    const origins = new Set();
    let valid = true;
    for (const policy of testCase.policies) {
      const identity = `${policy.site_id}:${policy.environment}`;
      if (keys.has(identity)) valid = false;
      keys.add(identity);
      for (const origin of policy.allowed_origins) {
        let canonical = false;
        try {
          const parsed = new URL(origin);
          canonical =
            ["http:", "https:"].includes(parsed.protocol) &&
            parsed.origin === origin &&
            !parsed.username &&
            !parsed.password;
        } catch {
          canonical = false;
        }
        if (!canonical) valid = false;
        const originIdentity = `${policy.site_id}:${new URL(origin).origin}`;
        if (origins.has(originIdentity)) valid = false;
        origins.add(originIdentity);
      }
    }
    if (valid !== testCase.expected_valid) fail(`policy semantic case failed: ${testCase.id}`);
    else pass(`policy semantic ${testCase.id}`);
  }

  const migrationCases = await readJson(
    path.join(contractRoot, "fixtures/legacy-mapping-cases.json"),
  );
  const legacyGroup = ["browser_context", "anonymous_visitors", "sessions", "dimensions"];
  for (const testCase of migrationCases.cases) {
    const legacyEnabled = testCase.legacy_analytics_enabled === true;
    const expected = Object.fromEntries(manifest.capabilities.map(({ id }) => [id, true]));
    for (const id of legacyGroup) expected[id] = legacyEnabled;
    const result = { ...expected, page_views: true };
    if (JSON.stringify(result) !== JSON.stringify(testCase.expected)) {
      fail(`legacy mapping case failed: ${testCase.id}`);
    } else {
      pass(`legacy mapping ${testCase.id}`);
    }
  }
}
