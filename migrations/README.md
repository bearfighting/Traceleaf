# PostgreSQL migrations

This directory is the source of truth for the PostgreSQL schema used by the
platform. Migrations are infrastructure-owned and are independent of the
Collector, Processor, and Analytics API services.

Run them through the standalone migrator:

```bash
DATABASE_URL=postgres://analytics:analytics@localhost:5432/analytics pnpm db:migrate
```

Migration files use one ordered SQLx migration history. Once a migration has
been applied, do not edit its filename, version, or SQL contents. Add a new
version for every subsequent schema change. New migrations should be
additive unless a destructive change has been separately reviewed and
approved.

Business services consume this schema but do not create or upgrade it during
startup. Deploy the migration job before deploying service versions that
require the new schema.

- `20260924001200_add_geo_country_facts.sql` stores country-only enrichment metadata and processor facts; raw client IP is never persisted.

- `20260925001300_create_configuration_storage.sql` adds versioned capability, environment policy, and redacted audit storage. It initializes capability documents from existing `analytics_feature_flags` rows; Collector TOML policies remain outside the database until runtime cutover.
- `20260925001400_allow_empty_ingest_key_policies.sql` permits an environment policy to exist before its first Ingest Key is issued; an empty key set remains fail-closed.

Configuration audit rows expire after one year. Compose deployments using the `storage` profile start `db-audit-purger`, which purges expired rows at startup and then every 24 hours. If a purge fails, it retries after one hour. To run it once manually, use `docker compose --profile storage run --rm db-migrate --purge-expired-configuration-audit`; locally, use `pnpm db:purge-configuration-audit`. Each run reports the number of rows removed.
- `20260925001500_create_configuration_runtime_state.sql` records per-Collector applied policy versions and instance heartbeats for API convergence reporting, including instances that have not yet loaded a newly created policy.

- `20260925001600_add_capability_runtime_state.sql` records capability configuration versions by site and service instance for Collector, Processor, and Analytics API. Capability convergence heartbeats are separate from PR4 environment-policy heartbeats; inactive capability runtime rows expire after one day.

- `20260926001700_create_definition_revisions.sql` stores immutable site-scoped Conversion/Funnel revisions and per-revision processor watermarks; it extends redacted configuration audit metadata for definition updates.

- `20260930001800_create_site_registry.sql` adds stable Site identity and optional metadata storage plus a derived setup-status view. It intentionally does not backfill identities or add references; those steps require the M3 importer and target-specific orphan preflight first.
