import { describe, expect, it } from "vitest";

import { isCreatedIngestKey, isIngestPolicyResponse } from "./validation";

const effectiveState = {
  status: "current",
  stored_version: 1,
  applied_versions: { collector: 1, processor: 1, analytics_api: 1 },
};
const keyMetadata = { key_id: "ik_alpha", created_at: "2026-10-01T00:00:00Z" };
const response = {
  policy: {
    site_id: "site_alpha",
    environment: "production",
    version: 1,
    enabled: true,
    allowed_origins: [],
    keys: [keyMetadata],
    rate_limit_per_minute: 600,
  },
  effective_state: effectiveState,
};

describe("Ingest Keys response validation", () => {
  it("accepts complete create and matching policy responses", () => {
    expect(
      isCreatedIngestKey({ key: "secret", metadata: keyMetadata, effective_state: effectiveState }),
    ).toBe(true);
    expect(isIngestPolicyResponse(response, "site_alpha", "production")).toBe(true);
  });

  it("rejects missing fields, invalid field types, and mismatched site or environment", () => {
    expect(isCreatedIngestKey({ key: "secret", metadata: keyMetadata })).toBe(false);
    expect(
      isIngestPolicyResponse(
        { ...response, policy: { ...response.policy, version: "1" } },
        "site_alpha",
        "production",
      ),
    ).toBe(false);
    expect(isIngestPolicyResponse(response, "site_beta", "production")).toBe(false);
    expect(isIngestPolicyResponse(response, "site_alpha", "staging")).toBe(false);
  });
});
