import type { IngestPolicyResponse } from "../configuration-api/types";

export interface EnvironmentPolicyInput {
  enabled: boolean;
  originsText: string;
  rateLimit: number;
}

export interface EnvironmentPolicyPayload {
  enabled: boolean;
  allowed_origins: string[];
  rate_limit_per_minute: number;
}

export function normalizeAllowedOrigins(originsText: string): string[] {
  return originsText
    .split("\n")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function toEnvironmentPolicyPayload(
  input: EnvironmentPolicyInput,
): EnvironmentPolicyPayload {
  return {
    enabled: input.enabled,
    allowed_origins: normalizeAllowedOrigins(input.originsText),
    rate_limit_per_minute: Number(input.rateLimit),
  };
}

export function policyFormValues(response: IngestPolicyResponse | null) {
  return {
    enabled: response?.policy.enabled ?? true,
    originsText: response?.policy.allowed_origins.join("\n") ?? "",
    rateLimit: response?.policy.rate_limit_per_minute ?? 600,
  };
}
