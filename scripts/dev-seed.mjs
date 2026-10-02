import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildCapabilityConfigurationSeedSql } from "./capability-seed.mjs";

export const DEV_SEED_SITE_ID = "site_example";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set to initialize the local development database.`);
  return value;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseOrigins(value) {
  const origins = [...new Set(value.split(",").map((origin) => origin.trim()))];
  if (origins.length === 0 || origins.some((origin) => origin.length === 0)) {
    throw new Error("DEV_SEED_ORIGINS must contain one or more comma-separated HTTP(S) origins.");
  }
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      !new Set(["http:", "https:"]).has(url.protocol) ||
      url.origin !== origin ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "DEV_SEED_ORIGINS must contain only HTTP(S) origins without paths, queries, or fragments.",
      );
    }
  }
  return origins;
}

function buildDevelopmentPolicySeedSql({ siteId, origins, ingestKey }) {
  const normalizedOrigins = parseOrigins(origins);
  const keyDigest = createHash("sha256").update(ingestKey).digest("hex");
  const keyId = `ik_${keyDigest.slice(0, 16)}`;

  return `
WITH seed AS (
  SELECT NOW() AS updated_at, ${sqlLiteral(siteId)}::text AS site_id,
    ARRAY[${normalizedOrigins.map((origin) => sqlLiteral(origin)).join(", ")}]::text[] AS origins,
    ${sqlLiteral(keyId)}::text AS key_id,
    ${sqlLiteral(keyDigest)}::text AS key_digest
)
INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document)
SELECT site_id, 'development', 1, updated_at, jsonb_build_object(
  'schema_version', 1,
  'site_id', site_id,
  'environment', 'development',
  'version', 1,
  'updated_at', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'enabled', TRUE,
  'allowed_origins', to_jsonb(origins),
  'ingest_keys', jsonb_build_array(jsonb_build_object(
    'key_id', key_id,
    'sha256_digest', key_digest,
    'created_at', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )),
  'rate_limit_per_minute', 600
)
FROM seed
ON CONFLICT (site_id, environment) DO NOTHING;
`;
}

export function buildDevelopmentSiteSeedSql({ origins, ingestKey }) {
  const siteId = DEV_SEED_SITE_ID;
  const registrySql = `
INSERT INTO site_registry (site_id, display_name, website_url)
VALUES (${sqlLiteral(siteId)}, 'Local Example Site', 'http://localhost:3000')
ON CONFLICT (site_id) DO NOTHING;
`;

  return [
    registrySql,
    buildCapabilityConfigurationSeedSql([siteId]),
    buildDevelopmentPolicySeedSql({ siteId, origins, ingestKey }),
  ].join("\n");
}

export function main() {
  const origins = requiredEnvironment("DEV_SEED_ORIGINS");
  const ingestKey = requiredEnvironment("DEV_SEED_INGEST_KEY");
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const sql = `BEGIN;\n${buildDevelopmentSiteSeedSql({ origins, ingestKey })}\nCOMMIT;`;
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--dbname", databaseUrl, "--command", sql],
    {
      encoding: "utf8",
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.stdout.write(`Initialized local development configuration for ${DEV_SEED_SITE_ID}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
