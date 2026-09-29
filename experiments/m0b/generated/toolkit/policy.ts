export interface StoredKey {
  keyId: string;
  sha256Digest: string;
  createdAt: string;
}

export interface StoredEnvironmentPolicyV1 {
  schemaVersion: 1;
  siteId: string;
  environment: string;
  version: number;
  updatedAt: string;
  enabled: boolean;
  allowedOrigins: string[];
  ingestKeys: StoredKey[];
  rateLimitPerMinute: number;
}