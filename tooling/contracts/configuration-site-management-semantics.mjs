import path from "node:path";

export async function validateSiteManagementSemantics({
  contractRoot,
  readJson,
  capabilityIds,
  fail,
  pass,
}) {
  const siteManagementCases = await readJson(
    path.join(contractRoot, "fixtures/site-management-cases.json"),
  );
  const normalization = siteManagementCases.normalization;
  const canonicalCapabilities = Object.fromEntries(
    capabilityIds.map((id) => [
      id,
      id === "page_views" || normalization.input.capabilities?.[id] === true,
    ]),
  );
  let normalizedOrigins = [];
  try {
    normalizedOrigins = normalization.input.allowed_origins
      .map((origin) => new URL(origin).origin)
      .sort();
  } catch {
    fail("Site creation normalization fixture contains an invalid Origin");
  }
  const normalizedWebsiteUrl = new URL(normalization.input.website_url);
  normalizedWebsiteUrl.hash = "";
  const normalizedRequest = {
    display_name: normalization.input.display_name.trim().normalize("NFC"),
    website_url: normalizedWebsiteUrl.href,
    environment: normalization.input.environment,
    capabilities: canonicalCapabilities,
    allowed_origins: normalizedOrigins,
  };
  if (
    JSON.stringify(normalizedRequest) !== JSON.stringify(normalization.canonical) ||
    normalization.digest_algorithm !== "SHA-256" ||
    normalization.canonical_json !== "RFC 8785"
  ) {
    fail("Site creation normalization fixture does not match its declared canonical request");
  } else {
    pass("site creation normalization, default capabilities and digest contract");
  }
  if (
    siteManagementCases.retries.length !== 4 ||
    siteManagementCases.retries.some((testCase) =>
      testCase.id === "same-key-same-request"
        ? testCase.expected_status !== 200 || testCase.returns_plaintext_key !== false
        : testCase.id === "same-key-different-request"
          ? testCase.expected_status !== 409 ||
            testCase.expected_error !== "site_idempotency_conflict"
          : testCase.id === "concurrent-same-key-same-request"
            ? testCase.one_site_created !== true || testCase.one_initial_plaintext_response !== true
            : testCase.id === "concurrent-same-key-different-request"
              ? testCase.one_request_commits !== true || testCase.other_response_status !== 409
              : true,
    ) ||
    siteManagementCases.retention.idempotency_association !== "site_lifetime_including_archive" ||
    siteManagementCases.retention.site_audit !== "site_lifetime_including_archive" ||
    siteManagementCases.retention.physical_site_delete !== false
  ) {
    fail("Site creation retry, concurrency or lifetime-retention contract fixture is inconsistent");
  } else {
    pass("site creation idempotency replay, conflict, concurrency and retention cases");
  }
  if (
    siteManagementCases.create_defaults.environment_policy_enabled !== true ||
    siteManagementCases.create_defaults.rate_limit_per_minute !== 600 ||
    siteManagementCases.create_defaults.generated_ingest_key_active !== true
  ) {
    fail("Site creation must create an enabled 600/minute policy with its initial key active");
  } else {
    pass("site creation initial environment policy and active key defaults");
  }
}
