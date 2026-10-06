import { readFileSync } from "node:fs";

const manifestUrl = new URL("../../protocol/capabilities/capabilities.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));

export const IMPLEMENTED_CAPABILITY_IDS = manifest.capabilities
  .filter((capability) => capability.status === "implemented")
  .map((capability) => capability.id);

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCapabilityConfigurationSeedSql(siteIds) {
  if (!Array.isArray(siteIds) || siteIds.length === 0) {
    throw new Error("At least one site ID is required to seed capability configuration.");
  }

  const normalizedSiteIds = [...new Set(siteIds.map((siteId) => siteId.trim()))];
  if (normalizedSiteIds.some((siteId) => siteId.length === 0 || siteId.length > 64)) {
    throw new Error("Seed site IDs must contain between 1 and 64 characters.");
  }

  const sites = normalizedSiteIds.map((siteId) => `(${sqlLiteral(siteId)})`).join(", ");
  const capabilities = IMPLEMENTED_CAPABILITY_IDS.map((id) => `(${sqlLiteral(id)})`).join(", ");

  return `
WITH sites(site_id) AS (VALUES ${sites}),
capabilities(capability_id) AS (VALUES ${capabilities}),
documents AS (
  SELECT sites.site_id, NOW() AS updated_at,
    jsonb_object_agg(capabilities.capability_id,
      jsonb_build_object('enabled', TRUE, 'settings', '{}'::jsonb)
    ) AS capabilities
  FROM sites CROSS JOIN capabilities
  GROUP BY sites.site_id
)
INSERT INTO site_capability_configurations (site_id, version, updated_at, document)
SELECT site_id, 1, updated_at, jsonb_build_object(
  'schema_version', 1,
  'site_id', site_id,
  'version', 1,
  'updated_at', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'capabilities', capabilities,
  'consent_policy', 'required',
  'privacy_constraints', jsonb_build_array('no_ip_persistence', 'no_fingerprinting', 'consent_required')
)
FROM documents
ON CONFLICT (site_id) DO NOTHING;

INSERT INTO site_capability_activation_windows (site_id, capability_id, enabled_since)
SELECT configurations.site_id, capability.key, '0001-01-01T00:00:00Z'::timestamptz
FROM site_capability_configurations AS configurations
CROSS JOIN LATERAL jsonb_each(configurations.document->'capabilities') AS capability(key, value)
WHERE configurations.site_id IN (${normalizedSiteIds.map(sqlLiteral).join(", ")})
  AND capability.value->>'enabled' = 'true'
ON CONFLICT (site_id, capability_id) DO NOTHING;
`;
}
