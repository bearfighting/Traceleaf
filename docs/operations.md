# Operations Guide

Operational procedures for PostgreSQL and country Geo data. Deployment-specific secrets, access controls, recovery ownership and monitoring must be selected for each target environment; the open release requirements are listed in [Project Status](project-status.md).

## Database migrations and tests

The standalone `db-migrator` owns schema creation and upgrades. Deploy and complete the migration job before starting Collector, Processor or Analytics API versions that require the new schema. Services do not migrate the database during startup.

For local migration and integration testing, create a dedicated test database and use a role allowed to create temporary databases. The migration harness also checks the selected database's migration history; integration tests apply migrations and write data. Do not use the development database. For the default local Compose credentials:

```bash
docker compose exec -T postgres createdb -U analytics analytics_test
export DATABASE_URL=postgres://analytics:analytics@localhost:5432/analytics_test
pnpm test:migrations
pnpm test:integration
```

The migration harness requires `psql` and `CREATEDB` privileges to create and clean up its temporary clean-install and upgrade databases. See [Database migration layout](../db/migrations/README.md) for migration ownership and local workflow.

## PostgreSQL backup and restore

Compose uses PostgreSQL 18.6 and the `postgres_data_v18` volume. Do not attach an existing PostgreSQL 17 data volume to the PostgreSQL 18 server. Before moving local data between major versions, back it up while the old server is running:

```bash
docker compose exec -T postgres pg_dump -U analytics -d analytics -Fc > analytics.pg_dump
```

Restore into the PostgreSQL 18 database and apply migrations created since the backup:

```bash
docker compose exec -T postgres pg_restore -U analytics -d analytics --clean --if-exists < analytics.pg_dump
pnpm db:migrate
```

Keep the backup outside version control and restrict access. Database backups include Site configuration, Ingest Key digests, definitions and audit records. Restore `CONFIG_ADMIN_TOKENS` separately from the deployment secret manager; retain required Ingest Key plaintext in the site's secret store because it cannot be recovered from the digest. After restore, wait for service-reported configuration versions to converge.

## Country Geo database

The backend requires an operator-supplied MMDB at `GEOIP_DATABASE_PATH` (default Compose path: `./data/GeoLite2-Country.mmdb`). MaxMind GeoLite2 Country and DB-IP City Lite are supported for ISO country lookup. The filename does not determine the provider; Collector validates the MMDB type and records provider/build metadata. Compose does not download data. A missing, unreadable, corrupt or unsupported file prevents Collector startup. Forwarded client IPs are ignored unless `GEOIP_TRUSTED_PROXIES` is configured with trusted proxy CIDRs.

MaxMind use requires an authorized account and compliance with its [GeoLite EULA](https://www.maxmind.com/en/geolite/eula). Credit MaxMind with a link to [maxmind.com](https://www.maxmind.com); destroy superseded copies within 30 days. See [MaxMind update guidance](https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases). DB-IP City Lite is under [CC BY 4.0](https://db-ip.com/db/download/ip-to-city-lite); applications displaying its data must link to DB-IP. The Dashboard conditionally credits DB-IP for date ranges containing its data.

For each operator-managed update:

1. Obtain the dataset under its license. Record provider, build/release epoch and published checksum. Do not commit the database or upload it as a CI artifact.
2. Verify the checksum and MMDB metadata. Accept only `GeoLite2-Country` or `DBIP-City-Lite`.
3. Validate the candidate in staging using synthetic requests through the configured trusted-proxy path. Confirm country and `unknown` results; never use or log a real visitor IP.
4. Keep a restricted, short-lived rollback copy. Verify the candidate again after copying it to a temporary file on the target filesystem, then atomically replace the configured database and restart Collector.
5. Check Collector health and a synthetic country report. If validation fails, atomically restore the verified previous file and restart Collector.
6. Record provider, epoch, checksum, deployment time and smoke-test outcome. Record aggregate coverage only, never IP addresses. Delete superseded licensed copies according to provider terms.

Unmapped or invalid individual addresses become `unknown`. Historical enrichment stores country code and source metadata; a later database update does not re-resolve old events.

The repository's [synthetic Geo test database](../tests/fixtures/geo/README.md) is for tests only. `pnpm test:geo-mmdb` runs local parser/startup tests; `pnpm test:geo-mmdb-local` checks an operator-provided DB-IP file. Neither command downloads data.
