import type { CreatedIngestKey, IngestPolicyResponse } from "../configuration-api/types";

function isKeyMetadata(value: unknown): value is CreatedIngestKey["metadata"] {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<CreatedIngestKey["metadata"]>;

  return (
    typeof metadata.key_id === "string" &&
    metadata.key_id.length > 0 &&
    typeof metadata.created_at === "string" &&
    Number.isFinite(Date.parse(metadata.created_at))
  );
}

function isEffectiveState(value: unknown): value is CreatedIngestKey["effective_state"] {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<CreatedIngestKey["effective_state"]>;

  return (
    (state.status === "current" || state.status === "pending" || state.status === "stale") &&
    Number.isInteger(state.stored_version) &&
    state.stored_version! > 0 &&
    !!state.applied_versions &&
    [
      state.applied_versions.collector,
      state.applied_versions.processor,
      state.applied_versions.analytics_api,
    ].every((version) => version === null || Number.isInteger(version))
  );
}

export function isCreatedIngestKey(value: unknown): value is CreatedIngestKey {
  if (!value || typeof value !== "object") return false;
  const created = value as Partial<CreatedIngestKey>;

  return (
    typeof created.key === "string" &&
    created.key.length > 0 &&
    isKeyMetadata(created.metadata) &&
    isEffectiveState(created.effective_state)
  );
}

export function isIngestPolicyResponse(
  value: unknown,
  siteId: string,
  environment: string,
): value is IngestPolicyResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<IngestPolicyResponse>;
  const policy = response.policy;

  return (
    !!policy &&
    policy.site_id === siteId &&
    policy.environment === environment &&
    Number.isInteger(policy.version) &&
    policy.version > 0 &&
    typeof policy.enabled === "boolean" &&
    Array.isArray(policy.allowed_origins) &&
    policy.allowed_origins.every((origin) => typeof origin === "string") &&
    Array.isArray(policy.keys) &&
    policy.keys.every(isKeyMetadata) &&
    Number.isInteger(policy.rate_limit_per_minute) &&
    policy.rate_limit_per_minute > 0 &&
    isEffectiveState(response.effective_state)
  );
}
