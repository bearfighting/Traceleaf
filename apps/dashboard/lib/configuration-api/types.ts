export type EffectiveStatus = "current" | "pending" | "stale";

export interface EffectiveState {
  status: EffectiveStatus;
  stored_version: number;
  applied_versions: {
    collector: number | null;
    processor: number | null;
    analytics_api: number | null;
  };
}

export interface CapabilityConfiguration {
  schema_version: 1;
  site_id: string;
  version: number;
  updated_at: string;
  capabilities: Record<string, { enabled: boolean; settings: Record<string, never> }>;
  consent_policy: "required";
  privacy_constraints: ["no_ip_persistence", "no_fingerprinting", "consent_required"];
}

export interface CapabilityResponse {
  configuration: CapabilityConfiguration;
  effective_state: EffectiveState;
}

export interface KeyMetadata {
  key_id: string;
  created_at: string;
}

export interface IngestPolicy {
  site_id: string;
  environment: string;
  version: number;
  enabled: boolean;
  allowed_origins: string[];
  keys: KeyMetadata[];
  rate_limit_per_minute: number;
}

export interface IngestPolicyResponse {
  policy: IngestPolicy;
  effective_state: EffectiveState;
}

export interface CreatedIngestKey {
  key: string;
  metadata: KeyMetadata;
  effective_state: EffectiveState;
}

export const CAPABILITY_LABELS: Record<string, string> = {
  page_views: "Page Views",
  browser_context: "Browser Context",
  anonymous_visitors: "Anonymous Visitors",
  sessions: "Sessions",
  dimensions: "Dimensions",
  custom_events: "Custom Events",
  web_vitals: "Web Vitals",
  conversions: "Conversions",
  funnels: "Funnels",
  geo: "Geo country",
};
