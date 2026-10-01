# Site Registry Importer

This CLI reconciles Site IDs from an explicitly selected PostgreSQL database and explicitly supplied legacy inputs. It is read-only by default. It does not load `.env` or Compose files.

## Inputs

`DATABASE_URL` must point to the intended target. For every static source, supply its value/path or its matching `--*-not-configured` flag:

- `--dashboard-sites` and `--dashboard-default-site`
- `--collector-config PATH`
- `--definitions-file PATH`
- `--dev-seed-site-id` and `--dev-seed-origins`

Examples of absent-source flags are `--collector-not-configured` and `--definitions-not-configured`. A configured but unreadable or invalid source is an error. Collector TOML contributes Site IDs, environment names, and Allowed Origins as local comparison clues only; `ingest_keys` values are discarded during deserialization and never enter the report. Policy coverage reads only the digest count, never the digest values.

Every run requires `--report /absolute/path/outside/the/repository/report.json`; the destination must not already exist. The importer creates it exclusively, rejects links and existing files, and updates the same open file after apply. The local report contains per-source row/distinct-ID counts, candidate IDs and source overlap, policy/environment coverage with enabled and non-secret counts, local Origin comparison evidence/conflicts, existing Registry metadata, missing name/URL status and IDs requiring review. It is local evidence and must not be committed. The stdout summary contains counts only.

## Review and apply

Run first without `--apply`. Candidates with test/fixture-like IDs, conflicting metadata, or no database identity source are marked `requires_disposition`. Create a local JSON file with one entry for each such ID:

```json
[
  {"site_id":"sample_fixture_site","action":"approve","reason":"confirmed retained Site identity"},
  {"site_id":"stale_static_site","action":"exclude","reason":"confirmed obsolete static entry"}
]
```

Persisted database identities cannot be excluded; approve them as Sites. Static-only candidates may be excluded after review. Missing metadata is allowed and remains null; Allowed Origins are included only as local comparison clues, never as Website URLs. Unresolved Origin or metadata conflicts block apply. Current static sources do not supply authoritative Site names or canonical URLs, so the importer writes identities only and never overwrites existing Registry metadata.

Apply is explicit and idempotent:

```sh
DATABASE_URL='postgres://…' cargo run -p site-registry-importer -- \
  --report /tmp/site-registry-import.json \
  --dashboard-sites 'site_alpha,site_beta' --dashboard-default-site site_alpha \
  --collector-config ./collector.toml --definitions-file ./definitions.json \
  --dev-seed-site-id site_alpha --dev-seed-origins https://site.example --dispositions-file /tmp/site-dispositions.json \
  --apply
```

For an absent input, replace its path/value with the corresponding `--*-not-configured` flag; dev-seed Site ID and origins have separate status flags. The dev-seed origin input is associated with the development environment. Apply acquires a transaction-scoped advisory lock and inserts missing Registry IDs only. It does not import policies or keys, mutate source tables, or add foreign keys.

## Safety

- Run target-specific dry-run before every apply. For this M3.3 implementation validation, apply only to a disposable PostgreSQL database.
- Do not pass ingest keys as CLI options. Never include secrets in disposition reasons.
- The detailed report path is rejected if it resolves inside the repository. It must be a new file; existing files, symlinks, and hard links are never overwritten.
- The importer requires the M3.2 `site_registry` schema and all inventoried source tables; it does not run migrations.

## M3 registry target-import runbook

M3.4 compatibility checks use a disposable PostgreSQL database only. The following steps describe a later, explicitly approved target import; they are not authorization to apply to a shared or deployment database during M3.4.

1. **Prepare and back up the target.** Obtain `DATABASE_URL` through the approved secret-injection mechanism; do not put a credential-bearing URL in shell history, command output, or this repository. Configure a password-free libpq service entry and protected passfile outside the repository for `pg_dump`/`psql`. Confirm the service resolves to the intended single target, then create and verify a custom-format backup:

   ```sh
   : "${PGSERVICE:?set the reviewed target service name}"
   psql "service=$PGSERVICE" -XAtc "SELECT current_database() || ' @ ' || inet_server_addr() || ':' || inet_server_port()"
   pg_dump --dbname="service=$PGSERVICE" --format=custom --no-owner --no-privileges --file="$BACKUP_FILE"
   pg_restore --list "$BACKUP_FILE" >/dev/null
   ```

   The importer’s `DATABASE_URL` and the libpq service used for backup must resolve to the same database and server. Verify both identities through the approved secret-injection path before proceeding; do not print either credential-bearing connection string.

   Record the database identity, backup path, and backup timestamp in the change record. The importer never applies migrations. Apply and verify M3.2 after this pre-migration baseline and before running the Importer.

### Migration preflight: read-only SQL baseline (after backup)

After the backup is verified and before applying migrations, set a new report path outside the repository and use the reviewed libpq service for this exact target. Do not place a credential-bearing connection URL in command arguments or output:

```sh
: "${PGSERVICE:?set the reviewed local target service name}"
: "${BASELINE_REPORT:?set a new absolute report path outside the repository}"
set -C
umask 077
psql "service=$PGSERVICE" -X -v ON_ERROR_STOP=1 > "$BASELINE_REPORT" <<'SQL'
BEGIN READ ONLY;
SELECT current_database() AS database_name,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       current_setting('listen_addresses') AS listen_addresses,
       current_setting('port') AS configured_port;
SELECT max(version) AS latest_successful_migration
FROM _sqlx_migrations WHERE success;
SELECT to_regclass('public.site_registry') AS site_registry_relation;
SELECT c.table_name AS site_id_table
FROM information_schema.columns AS c
WHERE c.table_schema = 'public' AND c.column_name = 'site_id'
  AND EXISTS (
      SELECT 1 FROM information_schema.tables AS t
      WHERE t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
  )
GROUP BY c.table_name ORDER BY c.table_name;
SELECT format(
  'SELECT %L AS source, count(*)::bigint AS rows, count(DISTINCT site_id)::bigint AS distinct_site_ids FROM %I.%I',
  c.table_name, c.table_schema, c.table_name
)
FROM information_schema.columns AS c
WHERE c.table_schema = 'public' AND c.column_name = 'site_id'
  AND EXISTS (
      SELECT 1 FROM information_schema.tables AS t
      WHERE t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
  )
GROUP BY c.table_schema, c.table_name
ORDER BY c.table_name
\gexec
SELECT 'configuration_audit' AS source, count(*)::bigint AS audit_rows,
       count(DISTINCT resource->>'site_id')::bigint AS distinct_site_ids
FROM configuration_audit WHERE resource ? 'site_id';
SELECT environment, count(*)::bigint AS policies,
       sum(jsonb_array_length(document->'allowed_origins'))::bigint AS allowed_origin_count,
       sum(jsonb_array_length(document->'ingest_keys'))::bigint AS key_digest_count
FROM site_environment_policies GROUP BY environment ORDER BY environment;
ROLLBACK;
SQL
```

The catalog query enumerates every public table with a direct `site_id` column; compare it with the M3 source matrix. Treat the two runtime-state tables as exclusion evidence and the four processing tables as cross-checks only. This baseline intentionally reports counts rather than per-Site details. If `inet_server_addr()` is null because the service uses a Unix socket, corroborate the server endpoint using the reviewed Compose container identity and published port. Stop if the database identity, table inventory, migration history, or report is incomplete. Keep the report outside version control.

2. **Run and review read-only preflight.** Use a new report path outside the repository. Supply every static source as an explicit value/path or `not_configured` flag, matching the target's actual inputs. Review candidate union, per-source row/distinct-ID counts, overlap, source-only IDs, Registry metadata, policy coverage, Origins and processing cross-checks. Resolve every Origin/metadata conflict and give each disposition-required ID a reasoned approve/exclude decision. A definitions-file-only ID is a static candidate; stored definition revisions require a capability row under the current schema.

3. **Apply only after review.** Reuse exactly the preflight source arguments and the reviewed disposition file, with a second new report path and explicit `--apply`. Capture the CLI exit status and `new Registry rows inserted` count. Do not manually insert Registry rows or policy/key data.

4. **Run postflight and reconcile.** Run the same inputs without `--apply` and write a third new report. Candidate union must match preflight; `db.site_registry_existing.distinct_site_ids` must equal its preflight count plus successful inserts. Confirm every approved candidate is present, excluded static-only IDs remain excluded, and the previously populated Registry metadata is unchanged. Compare preflight and postflight counts for the durable identity tables, audit rows, policy environment/origin evidence, key-digest counts, and processing cross-checks; the importer must not change any of them. Keep all three detailed reports (preflight, apply, and postflight) outside version control.

5. **Recover from failure.** Import writes run in one transaction. If an insert fails, confirm the process returned nonzero, retain the failed report and error, correct the underlying cause, then rerun preflight with a new report path and repeat apply with a new report path. Repeated apply is idempotent, so already committed identities produce zero new rows. Never delete Registry or history rows as an automatic rollback. Restore the verified backup only through the database recovery procedure if broader target damage occurred, with the restore scope and subsequent writes reviewed first.

For every apply, expected Registry cardinality is `preflight Registry rows + successful inserts`; source-table counts, policy documents, key digests, audit evidence, and history remain unchanged. Any mismatch pauses the rollout for investigation. M4 separately verifies the post-cutover fail-closed behavior for missing, disabled, and archived policies.
