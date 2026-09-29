#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyFixtures = path.join(
  root,
  "protocol/contracts/configuration/current/fixtures/environment-policy",
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateDateTime = ajv.compile({ type: "string", format: "date-time" });

function violations(document) {
  const fields = [];
  if (typeof document?.updated_at !== "string" || !validateDateTime(document.updated_at)) {
    fields.push("/updated_at");
  }
  if (!Array.isArray(document?.ingest_keys)) {
    fields.push("/ingest_keys");
    return fields;
  }
  document.ingest_keys.forEach((key, index) => {
    if (
      key === null ||
      typeof key !== "object" ||
      typeof key.created_at !== "string" ||
      !validateDateTime(key.created_at)
    ) {
      fields.push(`/ingest_keys/${index}/created_at`);
    }
  });
  return fields;
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function fixtureMode() {
  const valid = loadJson(path.join(policyFixtures, "valid/production.json"));
  const invalidUpdated = loadJson(
    path.join(policyFixtures, "invalid/invalid-updated-at-date-time.json"),
  );
  const invalidCreated = loadJson(
    path.join(policyFixtures, "invalid/invalid-key-created-at-date-time.json"),
  );

  const cases = [
    ["valid/production.json", valid, []],
    ["invalid/invalid-updated-at-date-time.json", invalidUpdated, ["/updated_at"]],
    [
      "invalid/invalid-key-created-at-date-time.json",
      invalidCreated,
      ["/ingest_keys/0/created_at"],
    ],
    [
      "PostgreSQL-accepted but Schema-invalid 24:00 timestamp",
      { ...valid, updated_at: "2026-09-29T24:00:00Z" },
      ["/updated_at"],
    ],
    ["missing updated_at", { ...valid, updated_at: undefined }, ["/updated_at"]],
    [
      "missing key created_at",
      { ...valid, ingest_keys: [{ ...valid.ingest_keys[0], created_at: undefined }] },
      ["/ingest_keys/0/created_at"],
    ],
  ];
  const failures = [];
  for (const [name, document, expectedFields] of cases) {
    if (JSON.stringify(violations(document)) !== JSON.stringify(expectedFields))
      failures.push(name);
  }

  if (failures.length > 0) {
    console.error(`date-time fixture audit failed: ${failures.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`date-time fixture audit passed (${cases.length} fixtures)`);
}

function databaseMode() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required; refusing to use libpq default connection settings");
    process.exitCode = 2;
    return;
  }

  const query = (qualifiedPolicyTable) => `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'site_id', site_id,
  'environment', environment,
  'document', jsonb_build_object(
    'updated_at', document->'updated_at',
    'ingest_keys', CASE
      WHEN jsonb_typeof(document->'ingest_keys') = 'array' THEN COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('created_at', key->'created_at') ORDER BY ordinal)
          FROM jsonb_array_elements(document->'ingest_keys') WITH ORDINALITY AS entry(key, ordinal)
        ),
        '[]'::jsonb
      )
      ELSE document->'ingest_keys'
    END
  )
)::text
FROM ${qualifiedPolicyTable}
ORDER BY site_id, environment;
COMMIT;`;
  const psqlArgs = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c"];
  const env = { ...process.env };
  for (const name of [
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGTARGETSESSIONATTRS",
    "PGOPTIONS",
  ]) {
    delete env[name];
  }

  {
    try {
      const connection = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(connection.protocol))
        throw new Error("DATABASE_URL must use PostgreSQL");
      if (connection.pathname.length <= 1)
        throw new Error("DATABASE_URL must include the target database name");
      if (!connection.hostname)
        throw new Error("DATABASE_URL must include an explicit target hostname");
      if (connection.hostname.includes(","))
        throw new Error("DATABASE_URL must identify a single target hostname");
      env.PGHOST = connection.hostname.replace(/^\[|\]$/g, "");
      env.PGTARGETSESSIONATTRS = "read-write";
      if (connection.port) env.PGPORT = connection.port;
      if (connection.username) env.PGUSER = decodeURIComponent(connection.username);
      if (connection.password) env.PGPASSWORD = decodeURIComponent(connection.password);
      if (connection.pathname.length > 1)
        env.PGDATABASE = decodeURIComponent(connection.pathname.slice(1));
      const queryOptions = {
        sslmode: "PGSSLMODE",
        sslcert: "PGSSLCERT",
        sslkey: "PGSSLKEY",
        sslrootcert: "PGSSLROOTCERT",
        application_name: "PGAPPNAME",
        connect_timeout: "PGCONNECT_TIMEOUT",
      };
      for (const [name, value] of connection.searchParams) {
        if (!queryOptions[name]) throw new Error(`unsupported DATABASE_URL option: ${name}`);
        env[queryOptions[name]] = value;
      }
    } catch (error) {
      console.error(`invalid database connection configuration: ${error.message}`);
      process.exitCode = 2;
      return;
    }
  }
  const relationQuery = `BEGIN TRANSACTION READ ONLY;
SELECT namespace.nspname
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE relation.oid = pg_catalog.to_regclass('site_environment_policies')
  AND relation.relkind IN ('r', 'p')
  AND (
    SELECT count(DISTINCT column_name.attname)
    FROM pg_catalog.pg_attribute AS column_name
    WHERE column_name.attrelid = relation.oid
      AND column_name.attname::text = ANY (ARRAY['site_id', 'environment', 'document'])
      AND column_name.attnum > 0
      AND NOT column_name.attisdropped
  ) = 3;
COMMIT;`;
  const relationResult = spawnSync("psql", [...psqlArgs, relationQuery], {
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024,
  });
  if (relationResult.error) {
    console.error(`could not run psql: ${relationResult.error.message}`);
    process.exitCode = 2;
    return;
  }
  if (relationResult.status !== 0) {
    if (relationResult.stderr) process.stderr.write(relationResult.stderr);
    process.exitCode = 2;
    return;
  }

  const schemas = relationResult.stdout.split(/\r?\n/).filter(Boolean);
  if (schemas.length !== 1) {
    console.error("could not resolve exactly one visible environment policy table in the target database");
    process.exitCode = 2;
    return;
  }
  const quotedSchema = `"${schemas[0].replaceAll('"', '""')}"`;
  const result = spawnSync(
    "psql",
    [...psqlArgs, query(`${quotedSchema}.site_environment_policies`)],
    { encoding: "utf8", env, maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error) {
    console.error(`could not run psql: ${result.error.message}`);
    process.exitCode = 2;
    return;
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = 2;
    return;
  }

  const findings = [];
  try {
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      for (const field of violations(row.document)) {
        findings.push({ site_id: row.site_id, environment: row.environment, field });
      }
    }
  } catch (error) {
    console.error(`could not parse read-only policy query output: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.log(
        `INVALID site_id=${JSON.stringify(finding.site_id)} environment=${JSON.stringify(finding.environment)} field=${finding.field}`,
      );
    }
    console.log(`found ${findings.length} invalid date-time field(s); no data was modified`);
    process.exitCode = 1;
    return;
  }
  console.log("all stored environment policy date-time fields are valid; no data was modified");
}

if (process.argv.slice(2).includes("--fixtures")) fixtureMode();
else if (process.argv.length > 2) {
  console.error("usage: node scripts/audit-policy-datetimes.mjs [--fixtures]");
  process.exitCode = 2;
} else databaseMode();
