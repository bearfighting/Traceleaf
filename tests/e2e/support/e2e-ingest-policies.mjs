import { createHash } from "node:crypto";

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildE2EIngestPolicySeedSql(siteKeys, allowedOrigins = ["http://localhost:3000"]) {
  if (!siteKeys || typeof siteKeys !== "object" || Object.keys(siteKeys).length === 0) {
    throw new Error("At least one E2E Site Ingest Key is required.");
  }

  const updatedAt = new Date().toISOString();
  const statements = Object.entries(siteKeys).map(([siteId, ingestKey]) => {
    const digest = createHash("sha256").update(ingestKey).digest("hex");
    const policy = {
      schema_version: 1,
      site_id: siteId,
      environment: "e2e",
      version: 1,
      updated_at: updatedAt,
      enabled: true,
      allowed_origins: allowedOrigins,
      ingest_keys: [
        {
          key_id: `ik_${digest.slice(0, 16)}`,
          sha256_digest: digest,
          created_at: updatedAt,
        },
      ],
      rate_limit_per_minute: 600,
    };
    return `INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document)
VALUES (${sqlLiteral(siteId)}, 'e2e', 1, ${sqlLiteral(updatedAt)}::timestamptz, ${sqlLiteral(JSON.stringify(policy))}::jsonb)
ON CONFLICT (site_id, environment) DO UPDATE SET version=EXCLUDED.version, updated_at=EXCLUDED.updated_at, document=EXCLUDED.document;`;
  });

  return `BEGIN;\n${statements.join("\n")}\nCOMMIT;`;
}

export function seedE2EIngestPolicies(runCompose, siteKeys, allowedOrigins) {
  runCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "analytics",
    "-d",
    "analytics",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    buildE2EIngestPolicySeedSql(siteKeys, allowedOrigins),
  ]);
}
