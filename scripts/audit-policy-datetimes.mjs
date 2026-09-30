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
const capabilityFixtures = path.join(
  root,
  "protocol/contracts/configuration/current/fixtures/capabilities",
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

function capabilityViolations(document) {
  return typeof document?.updated_at !== "string" || !validateDateTime(document.updated_at)
    ? ["/updated_at"]
    : [];
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

  const validCapabilities = loadJson(path.join(capabilityFixtures, "valid/legacy-enabled.json"));
  const invalidCapabilities = loadJson(
    path.join(capabilityFixtures, "invalid/invalid-updated-at-date-time.json"),
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
    ["capabilities valid fixture", validCapabilities, []],
    ["capabilities invalid date-time fixture", invalidCapabilities, ["/updated_at"]],
    [
      "capabilities 24:00 candidate",
      { ...validCapabilities, updated_at: "2026-09-29T24:00:00Z" },
      ["/updated_at"],
    ],
  ];
  const failures = [];
  for (const [name, document, expectedFields] of cases) {
    const actual = name.startsWith("capabilities")
      ? capabilityViolations(document)
      : violations(document);
    if (JSON.stringify(actual) !== JSON.stringify(expectedFields)) failures.push(name);
  }

  if (failures.length > 0) {
    console.error(`date-time fixture audit failed: ${failures.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`date-time fixture audit passed (${cases.length} policy/capability cases)`);
}

function databaseMode() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required; refusing to use libpq default connection settings");
    process.exitCode = 2;
    return;
  }

  const policyQuery = (table) =>
    `BEGIN TRANSACTION READ ONLY; SELECT jsonb_build_object('kind','policy','site_id',site_id,'environment',environment,'document',jsonb_build_object('updated_at',document->'updated_at','ingest_keys',CASE WHEN jsonb_typeof(document->'ingest_keys')='array' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('created_at',key->'created_at') ORDER BY ordinal) FROM jsonb_array_elements(document->'ingest_keys') WITH ORDINALITY AS entry(key,ordinal)),'[]'::jsonb) ELSE document->'ingest_keys' END))::text FROM ${table} ORDER BY site_id,environment; COMMIT;`;
  const capabilityQuery = (table) =>
    `BEGIN TRANSACTION READ ONLY; SELECT jsonb_build_object('kind','capabilities','site_id',site_id,'document',jsonb_build_object('updated_at',document->'updated_at'))::text FROM ${table} ORDER BY site_id; COMMIT;`;
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
SELECT relation.relname || E'\t' || namespace.nspname
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE relation.relname IN ('site_environment_policies', 'site_capability_configurations')
  AND relation.relkind IN ('r', 'p')
  AND (
    SELECT count(DISTINCT column_name.attname)
    FROM pg_catalog.pg_attribute AS column_name
    WHERE column_name.attrelid = relation.oid
      AND column_name.attname::text = ANY (CASE WHEN relation.relname = 'site_environment_policies' THEN ARRAY['site_id','environment','document'] ELSE ARRAY['site_id','document'] END)
      AND column_name.attnum > 0
      AND NOT column_name.attisdropped
  ) = CASE WHEN relation.relname = 'site_environment_policies' THEN 3 ELSE 2 END;
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

  const relationLines = relationResult.stdout.split(/\r?\n/).filter(Boolean);
  const tables = new Map(
    relationResult.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, schema] = line.split("\t");
        return [name, `\"${schema.replaceAll('\"', '\"\"')}\".${name}`];
      }),
  );
  if (
    relationLines.length !== 2 ||
    tables.size !== 2 ||
    !tables.has("site_environment_policies") ||
    !tables.has("site_capability_configurations")
  ) {
    console.error("could not resolve both configuration tables in the target database");
    process.exitCode = 2;
    return;
  }
  const findings = [];
  const auditedDocuments = { policy: 0, capabilities: 0 };
  for (const [kind, table, makeQuery] of [
    ["policy", tables.get("site_environment_policies"), policyQuery],
    ["capabilities", tables.get("site_capability_configurations"), capabilityQuery],
  ]) {
    const result = spawnSync("psql", [...psqlArgs, makeQuery(table)], {
      encoding: "utf8",
      env,
      maxBuffer: 32 * 1024 * 1024,
    });
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
    try {
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        const row = JSON.parse(line);
        auditedDocuments[kind] += 1;
        const fields =
          kind === "policy" ? violations(row.document) : capabilityViolations(row.document);
        for (const field of fields)
          findings.push({ site_id: row.site_id, environment: row.environment, kind, field });
      }
    } catch (error) {
      console.error(`could not parse read-only ${kind} query output: ${error.message}`);
      process.exitCode = 2;
      return;
    }
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.log(
        `INVALID kind=${finding.kind} site_id=${JSON.stringify(finding.site_id)}${finding.environment ? ` environment=${JSON.stringify(finding.environment)}` : ""} field=${finding.field}`,
      );
    }
    console.log(
      `audited policy_documents=${auditedDocuments.policy} capability_documents=${auditedDocuments.capabilities}; found ${findings.length} invalid date-time field(s); no data was modified`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `all stored policy and capability date-time fields are valid; policy_documents=${auditedDocuments.policy} capability_documents=${auditedDocuments.capabilities} invalid_fields=0; no data was modified`,
  );
}

if (process.argv.slice(2).includes("--fixtures")) fixtureMode();
else if (process.argv.length > 2) {
  console.error("usage: node scripts/audit-policy-datetimes.mjs [--fixtures]");
  process.exitCode = 2;
} else databaseMode();
